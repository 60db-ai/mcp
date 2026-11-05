/**
 * Agents Tools
 *
 * Exposes 60db Agents (AI voice agents that make phone calls) via MCP:
 *   - Agent CRUD (list, get, create, update, delete)
 *   - Place an outbound call as an agent
 *   - Call history, call detail, transcripts
 *   - Phone lines the agent can call from (read-only)
 *
 * Safety rules enforced here:
 *   - Placing a call rings a real phone and spends money (AI credits for
 *     speech/LLM, plus Dialer balance for line minutes on 60db numbers), so it
 *     requires an explicit confirm:true. Deleting an agent does too.
 *   - Phone-line create/delete is dashboard/API only, not exposed here.
 *   - SIP usernames, domains and passwords are never shown.
 *   - The webhook secret returned by create is shown once, with a warning.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AgentsListSchema,
  AgentsGetSchema,
  AgentsCreateSchema,
  AgentsUpdateSchema,
  AgentsDeleteSchema,
  AgentsPlaceCallSchema,
  AgentsStartStreamCallSchema,
  AgentsListCallsSchema,
  AgentsCallIdSchema,
  AgentsListPhoneLinesSchema,
  AgentsListParams,
  AgentsGetParams,
  AgentsCreateParams,
  AgentsUpdateParams,
  AgentsDeleteParams,
  AgentsPlaceCallParams,
  AgentsStartStreamCallParams,
  AgentsListCallsParams,
  AgentsCallIdParams,
  AgentsListPhoneLinesParams,
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import { formatErrorMessage, truncateIfNeeded } from "../services/response-formatter.js";
import { ResponseFormat, ApiError, RateLimitError } from "../types/index.js";

// ─ Local helpers ───────────────────────────────────────────

function respond(markdown: string, json: unknown, format: ResponseFormat) {
  const body = format === ResponseFormat.JSON ? JSON.stringify(json, null, 2) : markdown;
  const { content } = truncateIfNeeded(body, format === ResponseFormat.JSON);
  return { content: [{ type: "text" as const, text: content }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const ERROR_HINTS: Record<string, string> = {
  INSUFFICIENT_CREDITS: "Not enough AI credits for the call's speech/LLM runtime. Top up or upgrade in the 60db app (Billing).",
  DIALER_BALANCE_EMPTY: "The Dialer balance cannot cover the line minutes. Recharge it in the 60db app (Billing -> Dialer).",
  DIALER_NOT_PROVISIONED: "The workspace's Dialer is not set up yet. Complete Dialer setup in the 60db app (Dialer).",
  NUMBER_NOT_OWNED: "That number is not owned by this workspace. Use sixtydb_dialer_list_numbers / sixtydb_agents_list_phone_lines.",
  CONCURRENCY_LIMIT: "Too many calls are running at once for this plan. Wait for a call to end, then retry.",
  RATE_LIMITED: "Too many calls right now. Wait a moment and try again.",
  AGENT_NOT_FOUND: "Agent not found. Use sixtydb_agents_list to see valid agent IDs.",
  PHONE_LINE_NOT_FOUND: "Phone line not found. Use sixtydb_agents_list_phone_lines to see valid line IDs.",
  CALL_NOT_FOUND: "Call not found. Use sixtydb_agents_list_calls to see valid call IDs.",
  TRANSCRIPT_NOT_FOUND: "No transcript for this call (it may be unrecorded, still running, or deleted).",
  AGENTS_DISABLED: "Agents are not enabled on this API.",
  AGENTS_BETA_ONLY: "Agents are not enabled for this workspace yet. Contact 60db support.",
  KNOWLEDGE_COLLECTION_UNSUPPORTED: "That Smart Memory collection cannot be used as a knowledge base. Use a workspace (not personal) collection.",
};

const CODE_SUFFIX = /\(code: ([A-Z_]+)\)\s*$/;

/**
 * Map backend `code` (ApiError.details.code, or the "(code: X)" suffix the
 * api-client appends to the message for 400/401/403/404) to actionable text.
 */
function handleAgentsError(error: unknown): ReturnType<typeof errorResult> {
  const err = error as Error;
  if (err instanceof RateLimitError) {
    return errorResult(`**Error**: ${ERROR_HINTS.RATE_LIMITED}` + (err.retryAfter ? ` Retry after ${err.retryAfter}s.` : ""));
  }
  if (err instanceof ApiError) {
    const details = err.details as { code?: string; field?: string } | undefined;
    const code = details?.code || CODE_SUFFIX.exec(err.message)?.[1];
    const message = err.message.replace(CODE_SUFFIX, "").trim();
    if (code === "VALIDATION_ERROR") {
      const field = details?.field;
      return errorResult(`**Validation error**${field ? ` on \`${field}\`` : ""}: ${message}\n\nFix the value and retry.`);
    }
    if (code && ERROR_HINTS[code]) {
      return errorResult(`**Error** (${code}): ${message}\n\n${ERROR_HINTS[code]}`);
    }
    if (code) return errorResult(`**Error** (${code}): ${message}`);
  }
  return errorResult(formatErrorMessage(err));
}

function fmtRow(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `- **${k}**: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("\n");
}

function agentSummary(a: any): string {
  return `### ${a.name} (\`${a.id}\`)\n` + fmtRow({
    voice_id: a.voice_id,
    gender: a.gender,
    listen_languages: a.listen_languages?.join(", "),
    speak_languages: a.speak_languages?.join(", "),
    tools: a.tools?.length ? a.tools.map((t: any) => t.name).join(", ") : undefined,
    knowledge_collection_id: a.knowledge_collection_id,
    updated_at: a.updated_at,
  });
}

function agentDetail(a: any): string {
  return `### ${a.name} (\`${a.id}\`)\n` + fmtRow({
    voice_id: a.voice_id,
    gender: a.gender,
    emotion: a.emotion,
    greeting: a.greeting,
    listen_languages: a.listen_languages?.join(", "),
    speak_languages: a.speak_languages?.join(", "),
    tools: a.tools?.length ? a.tools.map((t: any) => `${t.name} - ${t.description}`).join("; ") : undefined,
    tool_webhook_url: a.tool_webhook_url,
    event_webhook_url: a.event_webhook_url,
    knowledge_collection_id: a.knowledge_collection_id,
    sentiments: a.sentiments?.length ? a.sentiments.map((s: any) => s.name).join(", ") : undefined,
    transfer_targets: a.transfer_targets?.length ? a.transfer_targets.map((t: any) => `${t.name} (${(t.numbers || []).length} number${(t.numbers || []).length === 1 ? "" : "s"})`).join(", ") : undefined,
    call_defaults: a.call_defaults && Object.keys(a.call_defaults).length ? a.call_defaults : undefined,
    created_at: a.created_at,
    updated_at: a.updated_at,
  }) + `\n\n**Script**:\n${a.script}`;
}

// Deliberately omits any SIP detail (domain/username/password), even if the API sent it.
function lineView(l: any) {
  return {
    id: l.id, kind: l.kind, name: l.name, caller_id: l.caller_id,
    inbound_number: l.inbound_number ?? null, agent_id: l.agent_id ?? null, agent_name: l.agent_name ?? null,
  };
}

function lineRow(l: any): string {
  return `- \`${l.id}\` **${l.name}** (${l.kind}) caller ID ${l.caller_id}` +
    (l.inbound_number ? `, inbound ${l.inbound_number}` : "") +
    (l.agent_name ? `, attached to ${l.agent_name}` : "");
}

function callSummary(c: any): string {
  return `- \`${c.id}\` ${c.direction} ${c.status} to ${c.to} from ${c.from}` +
    (c.agent_name ? ` (agent ${c.agent_name})` : "") +
    (c.duration_secs != null ? `, ${c.duration_secs}s` : "") + `, ${c.started_at || c.created_at}`;
}

function callDetail(c: any): string {
  return `### Call \`${c.id}\`\n` + fmtRow({
    agent: c.agent_name ? `${c.agent_name} (${c.agent_id})` : c.agent_id,
    phone_line_id: c.phone_line_id,
    direction: c.direction, sentiment: c.sentiment, status: c.status, reason: c.reason,
    to: c.to, from: c.from, duration_secs: c.duration_secs,
    started_at: c.started_at, connected_at: c.connected_at, ended_at: c.ended_at,
    recorded: c.record, has_recording: c.has_recording, has_transcript: c.has_transcript,
    answer_delay_p50_ms: c.analytics?.latency?.p50_ms, interruptions: c.analytics?.interruptions?.talked_over,
    transfer: c.analytics?.transfer?.outcome, packet_loss_percent: c.analytics?.network?.caller?.loss_percent,
    runtime_cost_usd: c.cost?.runtime_usd, runtime_billing_status: c.cost?.runtime_billing_status,
    source: c.source,
    metadata: c.metadata && Object.keys(c.metadata).length ? c.metadata : undefined,
    summary: c.summary,
  });
}

// ─ Tool registration ──────────────────────────────────────

export function registerAgentsTools(server: McpServer): void {
  const api = () => getApiClient();

  // ── sixtydb_agents_list ────────────────────────────────
  server.registerTool(
    "sixtydb_agents_list",
    {
      title: "List voice agents",
      description: `List the workspace's phone voice agents (paged).

**Returns:** \`agents[]\` (id, name, voice_id, languages, tools), \`total, limit, offset\`.`,
      inputSchema: AgentsListSchema,
      annotations: { title: "List agents", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: AgentsListParams) => {
      try {
        const res = await api().get<any>("/agents", { limit: params.limit, offset: params.offset });
        const d = res.data || res;
        const agents: any[] = d.agents || [];
        const md = `**Agents** (${agents.length} of ${d.total ?? agents.length})\n\n` +
          (agents.length ? agents.map(agentSummary).join("\n\n") : "_No agents yet. Create one with sixtydb_agents_create._");
        return respond(md, res, params.response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_get ─────────────────────────────────
  server.registerTool(
    "sixtydb_agents_get",
    {
      title: "Get a voice agent",
      description: `Get one agent's full configuration (script, greeting, tools, webhooks, call defaults) and the phone lines attached to it.`,
      inputSchema: AgentsGetSchema,
      annotations: { title: "Get agent", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: AgentsGetParams) => {
      try {
        const res = await api().get<any>(`/agents/${params.agent_id}`);
        const a = res.data || res;
        const lines: any[] = (a.phone_lines || []).map(lineView);
        const md = agentDetail(a) + `\n\n**Phone lines** (${lines.length}):\n` +
          (lines.length ? lines.map(lineRow).join("\n") : "_None attached._");
        const json = { ...res, data: { ...a, phone_lines: lines } };
        return respond(md, json, params.response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_create ──────────────────────────────
  server.registerTool(
    "sixtydb_agents_create",
    {
      title: "Create a voice agent",
      description: `Create a phone voice agent.

**Required:** \`name\` (unique, max 64), \`script\` (system prompt, max 8000), \`voice_id\`.
**Optional:** greeting, gender, listen_languages / speak_languages (lowercase codes like "en","hi"), emotion, tools (max 16, need \`tool_webhook_url\`), event_webhook_url, knowledge_collection_id (Smart Memory workspace collection), sentiments (call labels like hot/warm/cold, each {name, description}; omit for positive/negative/neutral; a finished call gets one label in its sentiment field), transfer_targets (call transfer: [{name: "Sales", numbers: ["+91…"]}], max 10; the agent offers transfer_to_<name> and rings the numbers in turn), call_defaults.

**Returns:** the agent plus a \`webhook_secret\` shown **only once**. Store it: it verifies the \`x-60db-signature\` on tool and event webhooks sent to your server.`,
      inputSchema: AgentsCreateSchema,
      annotations: { title: "Create agent", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: AgentsCreateParams) => {
      try {
        const { response_format, ...body } = params;
        const res = await api().post<any>("/agents", body);
        const a = res.data || res;
        let md = `**Agent created**\n\n` + agentDetail(a);
        if (a.webhook_secret) {
          md += `\n\n**WARNING: webhook_secret (shown once, store it now)**: \`${a.webhook_secret}\`\n` +
            `It cannot be retrieved again; if lost, rotate it from the dashboard or API.`;
        }
        return respond(md, res, response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_update ──────────────────────────────
  server.registerTool(
    "sixtydb_agents_update",
    {
      title: "Update a voice agent",
      description: `Update an agent. Pass \`agent_id\` and any fields to change (at least one); omitted fields stay as they are. \`tools\` replaces the whole list; the agent must keep a \`tool_webhook_url\` while it has tools.`,
      inputSchema: AgentsUpdateSchema,
      annotations: { title: "Update agent", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: AgentsUpdateParams) => {
      try {
        const { agent_id, response_format, ...body } = params;
        if (Object.keys(body).length === 0) {
          return errorResult("**Nothing to update**: pass at least one field besides `agent_id`.");
        }
        const res = await api().patch<any>(`/agents/${agent_id}`, body);
        const a = res.data || res;
        return respond(`**Agent updated**\n\n` + agentDetail(a), res, response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_delete ──────────────────────────────
  server.registerTool(
    "sixtydb_agents_delete",
    {
      title: "Delete a voice agent",
      description: `Delete an agent permanently. Phone lines attached to it are detached (not deleted); past calls stay in history.

- \`confirm\` (boolean, default false): **Without \`confirm: true\` this tool does nothing and only explains the consequence.**`,
      inputSchema: AgentsDeleteSchema,
      annotations: { title: "Delete agent", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params: AgentsDeleteParams) => {
      if (params.confirm !== true) {
        return errorResult(
          `**Confirmation required - nothing was deleted.**\n\n` +
          `Deleting agent \`${params.agent_id}\` is permanent: its configuration is removed and any phone lines using it are detached. Past calls remain in history.\n\n` +
          `Call this tool again with \`confirm: true\` to proceed.`
        );
      }
      try {
        const res = await api().delete<any>(`/agents/${params.agent_id}`);
        return respond(`**Agent deleted**: \`${params.agent_id}\``, res, params.response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_place_call ──────────────────────────
  server.registerTool(
    "sixtydb_agents_place_call",
    {
      title: "Place an outbound agent call",
      description: `Make an agent call a phone number. **This rings a real phone and spends money.**

**Costs:** AI credits for speech/LLM runtime per minute, plus Dialer balance for line minutes when the phone line is a 60db number (a BYO SIP line is billed by your carrier). Requires an active plan.

**Params:** \`agent_id\`, \`to\` (E.164), \`phone_line_id\` (sixtydb_agents_list_phone_lines), optional \`overrides\` (call_defaults + one-off greeting) and \`metadata\`.
- \`confirm\` (boolean, default false): **Without \`confirm: true\` this tool does not call anyone and only explains what will happen.**

**Returns:** the queued call (id, status). Poll with sixtydb_agents_get_call; read the result with sixtydb_agents_get_transcript. Only call numbers whose owner has agreed to be called, and follow local call-recording laws if \`record\` is on.`,
      inputSchema: AgentsPlaceCallSchema,
      annotations: { title: "Place agent call", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: AgentsPlaceCallParams) => {
      if (params.confirm !== true) {
        return errorResult(
          `**Confirmation required - no call was placed.**\n\n` +
          `Calling \`${params.to}\` as agent \`${params.agent_id}\` over line \`${params.phone_line_id}\` will:\n` +
          `- ring a real phone, and the agent will talk to whoever answers\n` +
          `- bill AI credits for speech/LLM runtime per minute\n` +
          `- bill Dialer balance for line minutes if the line is a 60db number (BYO lines are billed by your carrier)\n\n` +
          `Call this tool again with \`confirm: true\` to proceed.`
        );
      }
      try {
        const { agent_id, confirm: _confirm, response_format, ...body } = params;
        // The backend records source=mcp when it sees this header.
        const res = await api().post<any>(`/agents/${agent_id}/calls`, body, { "x-60db-client": "mcp" });
        const c = res.data || res;
        return respond(`**Call placed**\n\n` + callDetail(c) +
          `\n\nTrack it with sixtydb_agents_get_call (\`call_id: ${c.id}\`).`, res, response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_start_stream_call ───────────────────
  server.registerTool(
    "sixtydb_agents_start_stream_call",
    {
      title: "Start an agent call over a WebSocket",
      description: `Start a call whose audio is a **WebSocket** instead of a phone line (a PBX, Twilio/Exotel/Klicko media stream, or an app). No phone rings.

**Costs:** AI credits for speech/LLM once audio is streamed. No Dialer balance or phone line. Requires an active plan. Up to 3 at once per workspace.

**Params:** \`agent_id\`, optional \`overrides\` (call_defaults + one-off greeting) and \`metadata\`.
- \`confirm\` (boolean, default false): **Without \`confirm: true\` this tool starts nothing and only explains what will happen.**

**Returns:** the call and a one-time \`wss://api.60db.ai/ws/agents/stream/…?token=…\` URL (single use, valid 55 s, no API key in it). Whatever streams the audio connects to it and, within 10 s, sends \`{"event":"start","format":"mulaw"}\` (then binary 20 ms frames of 8 kHz audio) or Twilio Media Streams \`connected\` + \`start\` with \`mediaFormat\` (then base64 \`media\` events). Read the result later with sixtydb_agents_get_call.`,
      inputSchema: AgentsStartStreamCallSchema,
      annotations: { title: "Start stream call", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: AgentsStartStreamCallParams) => {
      if (params.confirm !== true) {
        return errorResult(
          `**Confirmation required - no call was started.**\n\n` +
          `Starting a stream call for agent \`${params.agent_id}\` will:\n` +
          `- return a one-time WebSocket URL (valid 55 s); the agent talks to whatever audio is streamed to it\n` +
          `- bill AI credits for speech/LLM while it runs (no phone line, no Dialer charge)\n\n` +
          `Call this tool again with \`confirm: true\` to proceed.`
        );
      }
      try {
        const { agent_id, confirm: _confirm, response_format, ...body } = params;
        const res = await api().post<any>(`/agents/${agent_id}/stream-calls`, body, { "x-60db-client": "mcp" });
        const d = res.data || res;
        return respond(`**Stream call started**\n\n` + callDetail(d.call) +
          `\n\n**WebSocket URL** (single use, ${d.expires_in}s):\n\`${d.url}\`\n\n` +
          `Connect and send \`{"event":"start","format":"mulaw"}\` (or Twilio-style \`connected\` + \`start\`) within 10 s.`,
          res, response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_list_calls ──────────────────────────
  server.registerTool(
    "sixtydb_agents_list_calls",
    {
      title: "List agent calls",
      description: `List agent call history (newest first), optionally filtered by \`agent_id\` and \`status\` (queued, dialing, in_progress, completed, failed). Paged with \`limit\`/\`offset\`.`,
      inputSchema: AgentsListCallsSchema,
      annotations: { title: "List agent calls", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: AgentsListCallsParams) => {
      try {
        const query: Record<string, unknown> = { limit: params.limit, offset: params.offset };
        if (params.agent_id) query.agent_id = params.agent_id;
        if (params.status) query.status = params.status;
        if (params.direction) query.direction = params.direction;
        const res = await api().get<any>("/agents/calls", query);
        const d = res.data || res;
        const calls: any[] = d.calls || [];
        const md = `**Agent calls** (${calls.length} of ${d.total ?? calls.length})\n\n` +
          (calls.length ? calls.map(callSummary).join("\n") : "_No calls match._");
        return respond(md, res, params.response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_get_call ────────────────────────────
  server.registerTool(
    "sixtydb_agents_get_call",
    {
      title: "Get an agent call",
      description: `Get one call: status, timings, duration, cost, metadata, and the post-call summary (turns, latency, tool calls, judge result).`,
      inputSchema: AgentsCallIdSchema,
      annotations: { title: "Get agent call", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: AgentsCallIdParams) => {
      try {
        const res = await api().get<any>(`/agents/calls/${params.call_id}`);
        return respond(callDetail(res.data || res), res, params.response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_get_transcript ──────────────────────
  server.registerTool(
    "sixtydb_agents_get_transcript",
    {
      title: "Get an agent call transcript",
      description: `Get the turn-by-turn transcript of a finished call, formatted as "Agent: ..." / "Caller: ...". Only available for recorded calls that have ended; otherwise returns a not-found explanation.`,
      inputSchema: AgentsCallIdSchema,
      annotations: { title: "Get call transcript", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: AgentsCallIdParams) => {
      try {
        const res = await api().get<any>(`/agents/calls/${params.call_id}/transcript`);
        const d = res.data || res;
        const turns: any[] = d.turns || [];
        const lines = turns.map((t) => {
          const who = String(t.role ?? t.speaker ?? "").toLowerCase();
          const label = who === "agent" || who === "assistant" ? "Agent" : who === "caller" || who === "user" ? "Caller" : (who === "note" ? "Note" : "Unknown");
          return `${label}: ${t.text ?? t.content ?? ""}`;
        });
        const md = `**Transcript** for call \`${params.call_id}\` (${turns.length} turns)\n\n` +
          (lines.length ? lines.join("\n") : "_Empty transcript._");
        return respond(md, res, params.response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );

  // ── sixtydb_agents_list_phone_lines ────────────────────
  server.registerTool(
    "sixtydb_agents_list_phone_lines",
    {
      title: "List agent phone lines",
      description: `List phone lines agents can call from (60db Dialer numbers or your own SIP trunk). Use a line's \`id\` as \`phone_line_id\` in sixtydb_agents_place_call.

SIP credentials are never shown. Creating or deleting lines is done in the 60db dashboard.`,
      inputSchema: AgentsListPhoneLinesSchema,
      annotations: { title: "List phone lines", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: AgentsListPhoneLinesParams) => {
      try {
        const res = await api().get<any>("/agents/phone-lines");
        const d = res.data || res;
        const lines: any[] = (d.phone_lines || []).map(lineView);
        const json = { ...res, data: { ...d, phone_lines: lines } };
        const md = `**Phone lines** (${lines.length})\n\n` +
          (lines.length ? lines.map(lineRow).join("\n") : "_No phone lines. Add one in the 60db dashboard (Agents -> Phone lines)._");
        return respond(md, json, params.response_format);
      } catch (error) {
        return handleAgentsError(error);
      }
    }
  );
}
