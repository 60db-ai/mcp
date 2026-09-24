/**
 * Dialer Tools
 *
 * Exposes 60db's Dialer (SIP calling) public v1 surface via MCP:
 *   - Account status, number search/purchase/release, caller ID
 *   - Call history and call detail lookup ("reserve call", not "make a call")
 *   - Recordings: list, get a short-lived playback URL, get a transcript
 *   - Billing: usage + active number subscriptions
 *
 * Safety rules enforced here:
 *   - No SIP credentials or trunk/webhook endpoints are exposed via MCP.
 *   - Buying or releasing a number requires an explicit confirm:true — real
 *     money moves ($6.00/number/month, billed immediately on purchase).
 *   - Buying a number also requires approved Dialer KYC, which can only be
 *     completed inside the 60db app (Dialer -> KYC) — there is no API for it,
 *     so this MCP server intentionally exposes no KYC tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DialerStatusSchema,
  DialerSearchNumbersSchema,
  DialerListNumbersSchema,
  DialerBuyNumberSchema,
  DialerReleaseNumberSchema,
  DialerSetCallerIdSchema,
  DialerListCallsSchema,
  DialerGetCallSchema,
  DialerListRecordingsSchema,
  DialerGetRecordingUrlSchema,
  DialerGetRecordingTranscriptSchema,
  DialerGetUsageSchema,
  DialerStatusParams,
  DialerSearchNumbersParams,
  DialerListNumbersParams,
  DialerBuyNumberParams,
  DialerReleaseNumberParams,
  DialerSetCallerIdParams,
  DialerListCallsParams,
  DialerGetCallParams,
  DialerListRecordingsParams,
  DialerGetRecordingUrlParams,
  DialerGetRecordingTranscriptParams,
  DialerGetUsageParams,
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import { formatErrorMessage, truncateIfNeeded } from "../services/response-formatter.js";
import { ResponseFormat, ApiError } from "../types/index.js";

// ─ Local helpers ───────────────────────────────────────────

function respond(markdown: string, json: unknown, format: ResponseFormat) {
  const body = format === ResponseFormat.JSON
    ? JSON.stringify(json, null, 2)
    : markdown;
  const { content } = truncateIfNeeded(body, format === ResponseFormat.JSON);
  return { content: [{ type: "text" as const, text: content }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const KYC_CODES = ["DIALER_KYC_REQUIRED", "DIALER_KYC_PENDING", "DIALER_KYC_REJECTED"];

/**
 * Dialer errors surface `code` on the response body (mapped through by the
 * api-client interceptor into ApiError.details). KYC-gated failures need a
 * specific, actionable message since there is no MCP (or API) tool to fix
 * them — the user must go complete KYC in the 60db app.
 */
function handleDialerError(error: unknown): ReturnType<typeof errorResult> {
  const err = error as Error;
  const code = err instanceof ApiError ? (err.details as any)?.code : undefined;
  if (code && KYC_CODES.includes(code)) {
    return errorResult(
      `**Error**: ${err.message}\n\n` +
      `Dialer KYC is required before you can buy a number. KYC cannot be completed via the API — ` +
      `go to the 60db app -> **Dialer -> KYC** to submit it, or wait for approval if it's already pending.`
    );
  }
  return errorResult(formatErrorMessage(err));
}

function fmtRow(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join("\n");
}

// ─ Tool registration ──────────────────────────────────────

export function registerDialerTools(server: McpServer): void {
  // ── sixtydb_dialer_get_status ──────────────────────────
  server.registerTool(
    "sixtydb_dialer_get_status",
    {
      title: "Get dialer account status",
      description: `Get the workspace's Dialer provisioning status.

**Returns (provisioned):** \`tenant_id, status, auth_mode, sip_username, credential_issued_at, default_caller_id, projection_state, numbers_count\`.
**Returns (not provisioned):** \`{ provisioned: false, numbers_count }\`.

Trunk setup and SIP credentials are configured in the 60db dashboard, not via this API.`,
      inputSchema: DialerStatusSchema,
      annotations: {
        title: "Dialer status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerStatusParams) => {
      try {
        const data = await getApiClient().get<any>("/dialer/status");
        const d = data.data || data;
        return respond(`**Dialer status**\n${fmtRow(d)}`, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_search_numbers ──────────────────────
  server.registerTool(
    "sixtydb_dialer_search_numbers",
    {
      title: "Search available numbers",
      description: `Search numbers available to buy from the shared pool (no filters supported by the API).

**Returns:** \`counts: { available, assigned, reserved }\`, \`available: [...]\` (numbers you could buy), \`allocated: [{ number, e164, status, assigned_at }]\` (numbers your workspace already owns).

Use \`sixtydb_dialer_buy_number\` to purchase one.`,
      inputSchema: DialerSearchNumbersSchema,
      annotations: {
        title: "Search numbers",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerSearchNumbersParams) => {
      try {
        const data = await getApiClient().get<any>("/dialer/pool");
        const d = data.data || data;
        const available = d.available || [];
        const md = [
          `**Number pool** — provisioned: ${d.provisioned ?? "?"}`,
          d.counts ? fmtRow(d.counts) : null,
          "",
          `**Available (${available.length}):**`,
          ...available.slice(0, 50).map((n: any) => `- ${typeof n === "string" ? n : JSON.stringify(n)}`),
        ].filter(Boolean).join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_list_numbers ────────────────────────
  server.registerTool(
    "sixtydb_dialer_list_numbers",
    {
      title: "List owned numbers",
      description: `List the phone numbers your workspace owns.

**Returns:** \`numbers: [...]\`, \`default_caller_id\`, \`provisioned\`.`,
      inputSchema: DialerListNumbersSchema,
      annotations: {
        title: "List numbers",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerListNumbersParams) => {
      try {
        const data = await getApiClient().get<any>("/dialer/numbers");
        const d = data.data || data;
        const numbers = d.numbers || [];
        const md = [
          `**Your numbers** (${numbers.length}) — default caller ID: ${d.default_caller_id || "none"}`,
          "",
          ...numbers.map((n: any) => `- ${JSON.stringify(n)}`),
        ].join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_buy_number ───────────────────────────
  server.registerTool(
    "sixtydb_dialer_buy_number",
    {
      title: "Buy a phone number",
      description: `Purchase a Dialer phone number from the shared pool. **This spends real money and requires approved KYC.**

**Costs:** $6.00 charged immediately, then $6.00/month recurring. If the wallet balance is too low the purchase is rolled back (402 \`RECHARGE_REQUIRED\`).

**Requires approved Dialer KYC**, completed inside the **60db app** (Dialer -> KYC) — KYC cannot be done through this API or any MCP tool.

**Parameters:**
- \`number\` (string, optional, E.164): A specific number to buy. Omit to buy the next available number from the pool.
- \`assign_for\` ('sip' | 'indian_number', optional): How the number will be used. 'sip' requires a finished trunk setup (done in the dashboard), otherwise 409 \`DIALER_NOT_PROVISIONED\`.
- \`confirm\` (boolean, required to actually purchase, default false): **Without \`confirm: true\` this tool does nothing and only explains the cost/requirements.**

**Error Handling:**
- 403 \`DIALER_KYC_REQUIRED\` / \`DIALER_KYC_PENDING\` / \`DIALER_KYC_REJECTED\`: complete or wait for KYC approval in the 60db app (Dialer -> KYC)
- 402 \`RECHARGE_REQUIRED\`: top up the workspace wallet
- 409 \`POOL_EMPTY\` / \`NUMBER_NOT_AVAILABLE\` / \`DIALER_NOT_PROVISIONED\`: pool exhausted, number taken, or trunk not set up`,
      inputSchema: DialerBuyNumberSchema,
      annotations: {
        title: "Buy number",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: DialerBuyNumberParams) => {
      if (params.confirm !== true) {
        return errorResult(
          `**Confirmation required**: buying a Dialer number charges **$6.00 now**, then **$6.00/month** recurring.\n\n` +
          `It also requires **approved Dialer KYC**, completed inside the **60db app** (Dialer -> KYC) — KYC cannot be done via this API or any MCP tool.\n\n` +
          `Call this tool again with \`confirm: true\`${params.number ? ` and \`number: "${params.number}"\`` : ""} to proceed.`
        );
      }
      try {
        const body: Record<string, unknown> = {};
        if (params.number) body.number = params.number;
        if (params.assign_for) body.assign_for = params.assign_for;

        const data = await getApiClient().post<any>("/dialer/pool/allocate", body);
        const d = data.data || data;
        return respond(`**Number purchased**\n${fmtRow(d)}`, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_release_number ──────────────────────
  server.registerTool(
    "sixtydb_dialer_release_number",
    {
      title: "Release a phone number",
      description: `Release (give up) a Dialer phone number. **This is irreversible** — the number is lost and its monthly rental is cancelled. If it was the default caller ID, that is cleared too.

**Parameters:**
- \`number\` (string, required, E.164)
- \`confirm\` (boolean, required to actually release, default false): **Without \`confirm: true\` this tool does nothing and only explains the consequence.**`,
      inputSchema: DialerReleaseNumberSchema,
      annotations: {
        title: "Release number",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerReleaseNumberParams) => {
      if (params.confirm !== true) {
        return errorResult(
          `**Confirmation required**: releasing \`${params.number}\` permanently gives up the number and cancels its monthly rental. This cannot be undone.\n\n` +
          `Call this tool again with \`confirm: true\` to proceed.`
        );
      }
      try {
        const data = await getApiClient().delete<any>(`/dialer/numbers/${encodeURIComponent(params.number)}`);
        return respond(`**Number released**: \`${params.number}\``, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_set_caller_id ───────────────────────
  server.registerTool(
    "sixtydb_dialer_set_caller_id",
    {
      title: "Set default caller ID",
      description: `Set the workspace's default outbound caller ID to a number you own.

**Parameters:**
- \`caller_id\` (string, required, E.164): Must be a number your workspace owns.

**Error Handling:**
- 403 \`CALLER_ID_NOT_OWNED\`: the number isn't owned by this workspace`,
      inputSchema: DialerSetCallerIdSchema,
      annotations: {
        title: "Set caller ID",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerSetCallerIdParams) => {
      try {
        const data = await getApiClient().put<any>("/dialer/caller-id", { caller_id: params.caller_id });
        const d = data.data || data;
        return respond(`**Default caller ID set**: ${d.default_caller_id || params.caller_id}`, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_list_calls ──────────────────────────
  server.registerTool(
    "sixtydb_dialer_list_calls",
    {
      title: "List call history",
      description: `List call history (CDRs) for the workspace.

**Parameters:**
- \`limit\` (number, optional, 1-200, default 50)
- \`offset\` (number, optional, default 0)

**Returns:** \`logs: [{ tenant_id, id, call_id, direction, disposition, from, to, billsec, start_ts }], total, limit, offset, has_more\`.`,
      inputSchema: DialerListCallsSchema,
      annotations: {
        title: "List calls",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerListCallsParams) => {
      try {
        const data = await getApiClient().get<any>("/dialer/logs", { limit: params.limit, offset: params.offset });
        const d = data.data || data;
        const logs = d.logs || [];
        const md = [
          `**Call history** (${d.total ?? logs.length} total, showing ${logs.length} at offset ${d.offset ?? params.offset})`,
          "",
          ...logs.map((c: any) => `- \`${c.id}\` ${c.direction} ${c.from} -> ${c.to} — ${c.disposition} — ${c.billsec ?? 0}s`),
          d.has_more ? `\n---\n**More available.** Use offset=${(d.offset ?? params.offset) + logs.length}.` : null,
        ].filter(Boolean).join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_get_call ─────────────────────────────
  server.registerTool(
    "sixtydb_dialer_get_call",
    {
      title: "Get call details",
      description: `Get details for a single call by ID.

**Parameters:**
- \`call_id\` (string, required)

**Error Handling:**
- 404 \`CALL_NOT_OWNED\`: call doesn't belong to this workspace`,
      inputSchema: DialerGetCallSchema,
      annotations: {
        title: "Get call",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerGetCallParams) => {
      try {
        const data = await getApiClient().get<any>(`/dialer/calls/${encodeURIComponent(params.call_id)}`);
        const d = data.data?.call || data.call || data.data || data;
        return respond(`**Call** \`${params.call_id}\`\n${fmtRow(d)}`, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_list_recordings ─────────────────────
  server.registerTool(
    "sixtydb_dialer_list_recordings",
    {
      title: "List call recordings",
      description: `List call recordings with optional filters.

**Parameters:**
- \`direction\` ('inbound' | 'outbound', optional)
- \`status\` (string, optional): Filter by recording status
- \`e164\` (string, optional, E.164): Filter by associated number
- \`limit\` (number, optional, 1-200, default 25)
- \`offset\` (number, optional, default 0)

**Returns:** \`recordings, total, limit, offset, has_more, recording_enabled, numbers, filtered_by, scope\`.`,
      inputSchema: DialerListRecordingsSchema,
      annotations: {
        title: "List recordings",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerListRecordingsParams) => {
      try {
        const queryParams: Record<string, unknown> = { limit: params.limit, offset: params.offset };
        if (params.direction) queryParams.direction = params.direction;
        if (params.status) queryParams.status = params.status;
        if (params.e164) queryParams.e164 = params.e164;

        const data = await getApiClient().get<any>("/dialer/recordings", queryParams);
        const d = data.data || data;
        const recordings = d.recordings || [];
        const md = [
          `**Recordings** (${d.total ?? recordings.length} total, showing ${recordings.length} at offset ${d.offset ?? params.offset}) — recording enabled: ${d.recording_enabled ?? "?"}`,
          "",
          ...recordings.map((r: any) => `- \`${r.id || r.recording_id}\` — ${JSON.stringify(r)}`.slice(0, 300)),
          d.has_more ? `\n---\n**More available.** Use offset=${(d.offset ?? params.offset) + recordings.length}.` : null,
        ].filter(Boolean).join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_get_recording_url ───────────────────
  server.registerTool(
    "sixtydb_dialer_get_recording_url",
    {
      title: "Get recording playback URL",
      description: `Generate a short-lived signed playback URL for a recording.

**Parameters:**
- \`recording_id\` (string, required)

**Returns:** \`{ playback_url, expires_at }\` — the link is valid for about **5 minutes**; call this again to get a fresh one.

**Error Handling:**
- 409 \`RECORDING_NOT_PLAYABLE\`: recording isn't ready or was deleted`,
      inputSchema: DialerGetRecordingUrlSchema,
      annotations: {
        title: "Get playback URL",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: DialerGetRecordingUrlParams) => {
      try {
        const data = await getApiClient().post<any>(`/dialer/recordings/${encodeURIComponent(params.recording_id)}/playback-url`, {});
        const d = data.data || data;
        return respond(`**Playback URL** (expires ${d.expires_at || "in ~5 min"}): ${d.playback_url}`, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_get_recording_transcript ────────────
  server.registerTool(
    "sixtydb_dialer_get_recording_transcript",
    {
      title: "Get recording transcript",
      description: `Get (or generate) the transcript for a call recording. Cached after the first call.

**Parameters:**
- \`recording_id\` (string, required)

**Error Handling:**
- 502 \`TRANSCRIPTION_FAILED\`: transcription service error — retry later`,
      inputSchema: DialerGetRecordingTranscriptSchema,
      annotations: {
        title: "Get transcript",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerGetRecordingTranscriptParams) => {
      try {
        const data = await getApiClient().post<any>(`/dialer/recordings/${encodeURIComponent(params.recording_id)}/transcript`, {});
        const d = data.data || data;
        return respond(`**Transcript** \`${params.recording_id}\`\n\n${JSON.stringify(d, null, 2)}`, data, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );

  // ── sixtydb_dialer_get_usage ────────────────────────────
  server.registerTool(
    "sixtydb_dialer_get_usage",
    {
      title: "Get dialer billing usage",
      description: `Combined Dialer billing summary: wallet balance + recent charges (from \`GET /dialer/usage\`) plus active number subscriptions (from \`GET /dialer/subscriptions\`).

**Parameters:**
- \`limit\` (number, optional, 1-200, default 50): Max charge entries to return

**Returns:** \`balance\`, \`charges: [{ service_type, amount_deducted, units_used, new_balance, metadata, created_at }]\`, \`subscriptions: [{ e164, status, next_charge_at, past_due_since, cancelled_at, cancel_reason, created_at }]\`.`,
      inputSchema: DialerGetUsageSchema,
      annotations: {
        title: "Get usage",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DialerGetUsageParams) => {
      try {
        const apiClient = getApiClient();
        const [usage, subs] = await Promise.all([
          apiClient.get<any>("/dialer/usage", { limit: params.limit }),
          apiClient.get<any>("/dialer/subscriptions"),
        ]);
        const u = usage.data || usage;
        const s = subs.data || subs;
        const charges = u.charges || [];
        const subscriptions = s.subscriptions || [];
        const md = [
          `**Dialer usage** — balance: ${u.balance ?? "?"}`,
          "",
          `**Recent charges (${charges.length}):**`,
          ...charges.slice(0, 20).map((c: any) => `- ${c.service_type} — ${c.amount_deducted} (units: ${c.units_used}) — balance after: ${c.new_balance} — ${c.created_at}`),
          "",
          `**Active number subscriptions (${subscriptions.length}):**`,
          ...subscriptions.map((sub: any) => `- ${sub.e164} — ${sub.status}${sub.next_charge_at ? ` — next charge: ${sub.next_charge_at}` : ""}${sub.past_due_since ? ` — past due since: ${sub.past_due_since}` : ""}`),
        ].join("\n");
        return respond(md, { usage: u, subscriptions: s }, params.response_format);
      } catch (error) {
        return handleDialerError(error);
      }
    }
  );
}
