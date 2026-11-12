/**
 * Call analysis ("analyzers") tools
 *
 * Exposes 60db Call analysis via the /deep-analytics API-key surface:
 *   - Analyzer CRUD (list, get, create, update, archive)
 *   - Add recordings by public URL (batch + server-side fetch), then analyze
 *   - Read recordings, problems, analytics and the per-call analysis
 *   - Fix agent: suggest / apply / undo an improved AI-agent script
 *
 * Only endpoints that user API keys may call are used, so every tool works with
 * a raw sk_ key and with OAuth sign-in (the hosted server unseals the OAuth token
 * to the user's API key before calling the API).
 *
 * Safety rules enforced here:
 *   - Analysis spends credits (speech-to-text + model), so it needs the exact
 *     confirm_count shown by the preview. Archive, apply and undo need confirm:true.
 *   - Every route needs the key's `call_analysis` permission (otherwise 403 DA_API_KEY_SCOPE_MISSING).
 *   - Fix agent tools need the key's `agents` permission (otherwise 403 POLICY_DENY).
 *   - Local file upload is not exposed; recordings are added by public URL only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallAnalysisListAnalyzersSchema,
  CallAnalysisCreateAnalyzerSchema,
  CallAnalysisGetAnalyzerSchema,
  CallAnalysisUpdateAnalyzerSchema,
  CallAnalysisArchiveAnalyzerSchema,
  CallAnalysisAddRecordingUrlsSchema,
  CallAnalysisAnalyzeSchema,
  CallAnalysisListRecordingsSchema,
  CallAnalysisGetProblemsSchema,
  CallAnalysisGetAnalyticsSchema,
  CallAnalysisGetCallAnalysisSchema,
  CallAnalysisSuggestAgentFixSchema,
  CallAnalysisApplyAgentFixSchema,
  CallAnalysisUndoAgentFixSchema,
  CallAnalysisListAnalyzersParams,
  CallAnalysisCreateAnalyzerParams,
  CallAnalysisGetAnalyzerParams,
  CallAnalysisUpdateAnalyzerParams,
  CallAnalysisArchiveAnalyzerParams,
  CallAnalysisAddRecordingUrlsParams,
  CallAnalysisAnalyzeParams,
  CallAnalysisListRecordingsParams,
  CallAnalysisGetProblemsParams,
  CallAnalysisGetAnalyticsParams,
  CallAnalysisGetCallAnalysisParams,
  CallAnalysisSuggestAgentFixParams,
  CallAnalysisApplyAgentFixParams,
  CallAnalysisUndoAgentFixParams,
} from "../schemas/index.js";
import { CALL_ANALYSIS_FETCH_BATCH_SIZE } from "../constants.js";
import { getApiClient } from "../services/api-client.js";
import { formatErrorMessage, truncateIfNeeded } from "../services/response-formatter.js";
import { ResponseFormat, ApiError, RateLimitError } from "../types/index.js";

const BASE = "/deep-analytics";

// ─ Local helpers ───────────────────────────────────────────

function respond(markdown: string, json: unknown, format: ResponseFormat) {
  const body = format === ResponseFormat.JSON ? JSON.stringify(json, null, 2) : markdown;
  const { content } = truncateIfNeeded(body, format === ResponseFormat.JSON);
  return { content: [{ type: "text" as const, text: content }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/** Markdown body: a heading plus the API payload as a JSON block. */
function md(title: string, data: unknown): string {
  return `**${title}**\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

const unwrap = (res: any): any => (res && typeof res === "object" && "data" in res ? res.data : res);

const ERROR_HINTS: Record<string, string> = {
  DA_API_KEY_DENIED: "This API key cannot use that route. Only Call analysis analyzer routes are open to API keys.",
  DA_API_KEY_RATE_LIMITED: "Too many Call analysis requests for this key. Wait a minute and retry.",
  DA_API_KEY_SCOPE_MISSING: "Enable the Call analysis permission on this API key in the 60db dashboard: Developers → API keys.",
  AGENT_FIX_RATE_LIMITED: "Fix agent is limited to 10 requests per minute. Wait and retry.",
  POLICY_DENY: "Permission denied. The key owner needs access to this analyzer. Fix agent tools also need the API key's `agents` permission (enable it in the 60db app, API keys).",
  DA_MEMBERSHIP_REQUIRED: "The workspace owner has no active membership in this workspace.",
  COMMIT_CONFIRMATION_MISMATCH: "The number of ready recordings changed. Run sixtydb_call_analysis_analyze without confirm_count to preview the current number.",
  AGENT_CHANGED: "The agent script changed since the suggestion. Run sixtydb_call_analysis_suggest_agent_fix again.",
  NOT_AN_AGENT_CALL: "Fix agent only works for calls made by a 60db AI agent.",
  NO_PROBLEMS: "This call has no problems to fix.",
  CALL_NOT_FOUND: "Call not found, or it was not imported for an analyzer.",
  NOT_FOUND: "Not found. The id may be wrong, archived, or not visible to this key.",
};

const CODE_SUFFIX = /\(code: ([A-Z_]+)\)\s*$/;

function handleCallAnalysisError(error: unknown): ReturnType<typeof errorResult> {
  const err = error as Error;
  if (err instanceof RateLimitError) {
    return errorResult(`**Error**: Rate limited.` + (err.retryAfter ? ` Retry after ${err.retryAfter}s.` : ""));
  }
  if (err instanceof ApiError) {
    const details = err.details as { code?: string; field?: string } | undefined;
    const code = details?.code || CODE_SUFFIX.exec(err.message)?.[1];
    const message = err.message.replace(CODE_SUFFIX, "").trim();
    if (code === "VALIDATION_ERROR") {
      const field = details?.field;
      return errorResult(`**Validation error**${field ? ` on \`${field}\`` : ""}: ${message}\n\nFix the value and retry.`);
    }
    if (code && ERROR_HINTS[code]) return errorResult(`**Error** (${code}): ${message}\n\n${ERROR_HINTS[code]}`);
    if (code) return errorResult(`**Error** (${code}): ${message}`);
  }
  return errorResult(formatErrorMessage(err));
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** CSV for a csv_urls batch: one row per URL, with a stable external_call_ref. */
export function buildRecordingCsv(urls: string[]): string {
  return ["external_call_ref,recording_url", ...urls.map((u, i) => `${csvCell(`url-${i + 1}`)},${csvCell(u)}`)].join("\n") + "\n";
}

/** Drop undefined so optional fields are not sent (null is kept: it clears a field). */
function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const api = () => getApiClient();
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

// ─ Tool registration ──────────────────────────────────────

export function registerCallAnalysisTools(server: McpServer): void {
  // ── list_analyzers ───────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_list_analyzers",
    {
      title: "List call analyzers",
      description: `List Call analysis analyzers visible to the workspace.

**Returns:** \`[{ id, name, description, my_role, version_no, recordings, analyzed, with_problems, updated_at }]\`.`,
      inputSchema: CallAnalysisListAnalyzersSchema,
      annotations: { title: "List analyzers", ...READ },
    },
    async (params: CallAnalysisListAnalyzersParams) => {
      try {
        const res = await api().get<any>(`${BASE}/analysis-agents`);
        const list: any[] = unwrap(res) || [];
        const md_ = list.length
          ? list.map((a) => `- **${a.name}** (\`${a.id}\`) - ${a.recordings ?? 0} recordings, ${a.analyzed ?? 0} analyzed, ${a.with_problems ?? 0} with problems`).join("\n")
          : "No analyzers yet. Create one with sixtydb_call_analysis_create_analyzer.";
        return respond(`**Analyzers (${list.length})**\n\n${md_}`, res, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── create_analyzer ──────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_create_analyzer",
    {
      title: "Create a call analyzer",
      description: `Create an analyzer: a named brief that says what to look for in call recordings.

**Params:** \`name\` (1-120), \`instructions\` (1-20000), optional \`description\`, \`knowledge_collection_id\`, \`key_terms\`, \`language\`.
**Returns:** the analyzer (\`id\` is the \`agent_id\` for every other call analysis tool).
Next: sixtydb_call_analysis_add_recording_urls, then sixtydb_call_analysis_analyze.`,
      inputSchema: CallAnalysisCreateAnalyzerSchema,
      annotations: { title: "Create analyzer", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CallAnalysisCreateAnalyzerParams) => {
      try {
        const { response_format, ...body } = params;
        const res = await api().post<any>(`${BASE}/analysis-agents`, definedOnly(body));
        const a = unwrap(res);
        return respond(`**Analyzer created**: ${a?.name} (\`${a?.id}\`)\n\n${md("Analyzer", a)}`, res, response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── get_analyzer ─────────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_get_analyzer",
    {
      title: "Get a call analyzer",
      description: `Get one analyzer with its instructions, key terms, version and recording counts (\`recordings, analyzed, with_problems, waiting, ready, failed\`).`,
      inputSchema: CallAnalysisGetAnalyzerSchema,
      annotations: { title: "Get analyzer", ...READ },
    },
    async (params: CallAnalysisGetAnalyzerParams) => {
      try {
        const res = await api().get<any>(`${BASE}/analysis-agents/${params.agent_id}`);
        return respond(md("Analyzer", unwrap(res)), res, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── update_analyzer ──────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_update_analyzer",
    {
      title: "Update a call analyzer",
      description: `Update an analyzer. Send only the fields to change (at least one). Changing \`name\`/\`instructions\` creates a new analyzer version; already-analyzed calls keep their results.`,
      inputSchema: CallAnalysisUpdateAnalyzerSchema,
      annotations: { title: "Update analyzer", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: CallAnalysisUpdateAnalyzerParams) => {
      const { agent_id, response_format, ...fields } = params;
      const body = definedOnly(fields);
      if (Object.keys(body).length === 0) {
        return errorResult("**Validation error**: send at least one field to update (name, instructions, description, knowledge_collection_id, key_terms, language).");
      }
      try {
        const res = await api().put<any>(`${BASE}/analysis-agents/${agent_id}`, body);
        return respond(md("Analyzer updated", unwrap(res)), res, response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── archive_analyzer ─────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_archive_analyzer",
    {
      title: "Archive a call analyzer",
      description: `Archive an analyzer. It stops watching call agents and disappears from the list; calls and recordings are kept.

- \`confirm\` (boolean, default false): **Without \`confirm: true\` this tool does nothing and only explains the consequence.**`,
      inputSchema: CallAnalysisArchiveAnalyzerSchema,
      annotations: { title: "Archive analyzer", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params: CallAnalysisArchiveAnalyzerParams) => {
      if (params.confirm !== true) {
        return errorResult(
          `**Confirmation required - nothing was archived.**\n\n` +
          `Archiving analyzer \`${params.agent_id}\` stops it watching call agents and removes it from the list. Calls and recordings are kept.\n\n` +
          `Call this tool again with \`confirm: true\` to proceed.`
        );
      }
      try {
        const res = await api().delete<any>(`${BASE}/analysis-agents/${params.agent_id}`);
        return respond(`**Analyzer archived**: \`${params.agent_id}\``, res, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── add_recording_urls ───────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_add_recording_urls",
    {
      title: "Add call recordings by URL",
      description: `Add recordings to an analyzer from public http(s) URLs. Creates a batch, then the 60db server downloads each URL (private/internal addresses are blocked). Does NOT start analysis and costs no credits.

**Params:** \`agent_id\`, \`urls\` (1-50), optional \`name\`.
**Returns:** batch id, row counts (\`total, valid, invalid\`) and fetch counts (\`stored, failed, skipped\`). Failed downloads are reported, not thrown; fix the URL and add it again.
Next: sixtydb_call_analysis_analyze (preview first), then sixtydb_call_analysis_list_recordings.`,
      inputSchema: CallAnalysisAddRecordingUrlsSchema,
      annotations: { title: "Add recording URLs", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CallAnalysisAddRecordingUrlsParams) => {
      try {
        const batchRes = await api().post<any>(`${BASE}/analysis-agents/${params.agent_id}/batches`, definedOnly({
          source_kind: "csv_urls",
          csv_text: buildRecordingCsv(params.urls),
          name: params.name,
        }));
        const batch = unwrap(batchRes);
        const batchId: string = batch?.id;
        if (!batchId) return errorResult("**Error**: the API did not return a batch id.");

        // The API downloads up to `limit` pending rows per call; repeat until none are attempted.
        const totals = { attempted: 0, stored: 0, failed: 0, skipped: 0 };
        const maxRounds = Math.ceil(params.urls.length / CALL_ANALYSIS_FETCH_BATCH_SIZE) + 1;
        let fetchError: string | undefined;
        for (let round = 0; round < maxRounds; round++) {
          let out: any;
          try {
            out = unwrap(await api().post<any>(`${BASE}/imports/batches/${batchId}/fetch-recordings`, { limit: CALL_ANALYSIS_FETCH_BATCH_SIZE }));
          } catch (error) {
            fetchError = handleCallAnalysisError(error).content[0].text;
            break;
          }
          if (!out?.attempted) break;
          for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += Number(out[k]) || 0;
        }

        const summary = { batch_id: batchId, rows: { total: batch.total, valid: batch.valid, invalid: batch.invalid }, fetch: totals, fetch_error: fetchError };
        const text = [
          `**Recordings added** - batch \`${batchId}\``,
          `- Rows: ${batch.total} total, ${batch.valid} valid, ${batch.invalid} invalid`,
          `- Downloaded: ${totals.stored} stored, ${totals.failed} failed, ${totals.skipped} skipped`,
          fetchError ? `\nDownload stopped early:\n${fetchError}` : "",
          `\nAnalysis has not started. Use sixtydb_call_analysis_analyze to preview the count and cost.`,
        ].filter(Boolean).join("\n");
        return respond(text, summary, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── analyze ──────────────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_analyze",
    {
      title: "Analyze ready recordings",
      description: `Analyze every READY recording of an analyzer. **Costs credits** (paid speech-to-text and model usage).

Two steps:
1. Call with only \`agent_id\`: nothing is analyzed; returns how many recordings are ready.
2. Call again with \`confirm_count\` = that number to start. If the number changed, nothing starts (409 COMMIT_CONFIRMATION_MISMATCH).

**Returns (step 2):** \`committed, starting_now, waiting_for_upload, already_committed, estimated_credits_usd, estimate_partial\`. Repeating a call commits nothing new.
Poll with sixtydb_call_analysis_list_recordings until status is \`done\` or \`failed\`.`,
      inputSchema: CallAnalysisAnalyzeSchema,
      annotations: { title: "Analyze recordings", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: CallAnalysisAnalyzeParams) => {
      try {
        if (params.confirm_count === undefined) {
          const res = await api().get<any>(`${BASE}/analysis-agents/${params.agent_id}/recordings`, { status: "ready", limit: 1 });
          const ready = Number(unwrap(res)?.total ?? 0);
          return respond(
            `**Confirmation required - nothing was analyzed.**\n\n` +
            `${ready} recording(s) are ready. Analysis spends credits. ` +
            (ready > 0 ? `Call this tool again with \`confirm_count: ${ready}\` to start.` : `Add recordings first with sixtydb_call_analysis_add_recording_urls.`),
            { ready, confirm_required: true }, params.response_format);
        }
        const res = await api().post<any>(`${BASE}/analysis-agents/${params.agent_id}/analyze`, { confirm_count: params.confirm_count });
        return respond(md("Analysis started", unwrap(res)), res, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── list_recordings ──────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_list_recordings",
    {
      title: "List analyzer recordings",
      description: `List an analyzer's recordings with status and verdict, newest first.

**Filters:** \`status\` (uploading|ready|waiting|transcribing|analyzing|done|failed|cancelled), \`category\`, \`severity\`, \`q\` (title/person), \`limit\` (1-100), \`offset\`.
**Returns:** \`{ total, items: [{ call_id, item_id, title, status, verdict, problem_count, top_problem, sentiment, source }] }\`. \`call_id\` (null until audio exists) feeds sixtydb_call_analysis_get_call_analysis.`,
      inputSchema: CallAnalysisListRecordingsSchema,
      annotations: { title: "List recordings", ...READ },
    },
    async (params: CallAnalysisListRecordingsParams) => {
      try {
        const { agent_id, response_format, ...query } = params;
        const res = await api().get<any>(`${BASE}/analysis-agents/${agent_id}/recordings`, definedOnly(query));
        const d = unwrap(res) || {};
        const items: any[] = d.items || [];
        const lines = items.map((r) =>
          `- **${r.title ?? r.item_id}** - ${r.status}${r.verdict ? `, ${r.verdict}` : ""}` +
          `${r.problem_count ? `, ${r.problem_count} problem(s)` : ""}${r.call_id ? ` (call \`${r.call_id}\`)` : ""}`);
        return respond(`**Recordings** (${items.length} of ${d.total ?? items.length})\n\n${lines.join("\n") || "None."}`, res, response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── get_problems ─────────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_get_problems",
    {
      title: "Get analyzer problems summary",
      description: `Summarize the problems an analyzer found: \`analyzed, with_problems, by_category, by_severity\` and the top recurring problems (max 20, each with an \`example_call_id\`). Optional \`from\`/\`to\` ISO dates.`,
      inputSchema: CallAnalysisGetProblemsSchema,
      annotations: { title: "Get problems", ...READ },
    },
    async (params: CallAnalysisGetProblemsParams) => {
      try {
        const { agent_id, response_format, ...query } = params;
        const res = await api().get<any>(`${BASE}/analysis-agents/${agent_id}/problems`, definedOnly(query));
        return respond(md("Problems", unwrap(res)), res, response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── get_analytics ────────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_get_analytics",
    {
      title: "Get call analysis analytics",
      description: `Chart data over time. With \`agent_id\`: totals, daily trend and breakdowns by kind, source and person for that analyzer. Without it: workspace overview across all analyzers. \`days\`: 7, 30 (default) or 90.`,
      inputSchema: CallAnalysisGetAnalyticsSchema,
      annotations: { title: "Get analytics", ...READ },
    },
    async (params: CallAnalysisGetAnalyticsParams) => {
      try {
        const path = params.agent_id ? `${BASE}/analysis-agents/${params.agent_id}/analytics` : `${BASE}/analysis-agents-analytics`;
        const res = await api().get<any>(path, { days: params.days });
        return respond(md("Analytics", unwrap(res)), res, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── get_call_analysis ────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_get_call_analysis",
    {
      title: "Get one call's analysis",
      description: `Get the full analysis of one call: transcript, stage status, findings (type, status, reason, evidence, problem category/severity). Only calls imported for an analyzer; get \`call_id\` from sixtydb_call_analysis_list_recordings.`,
      inputSchema: CallAnalysisGetCallAnalysisSchema,
      annotations: { title: "Get call analysis", ...READ },
    },
    async (params: CallAnalysisGetCallAnalysisParams) => {
      try {
        const res = await api().get<any>(`${BASE}/calls/${params.call_id}/analysis`);
        return respond(md("Call analysis", unwrap(res)), res, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── suggest_agent_fix ────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_suggest_agent_fix",
    {
      title: "Suggest an AI agent fix",
      description: `Suggest improved instructions for the 60db AI agent that made a call with problems. **Saves nothing.** Needs the API key's \`agents\` permission. Limit 10/min.

**Returns:** \`{ agent, base_hash, before, after, changes, problems }\`. Review it, then pass \`base_hash\` and the script to sixtydb_call_analysis_apply_agent_fix.`,
      inputSchema: CallAnalysisSuggestAgentFixSchema,
      annotations: { title: "Suggest agent fix", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CallAnalysisSuggestAgentFixParams) => {
      try {
        const res = await api().post<any>(`${BASE}/calls/${params.call_id}/agent-fix/suggest`);
        return respond(md("Suggested agent fix (not saved)", unwrap(res)), res, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── apply_agent_fix ──────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_apply_agent_fix",
    {
      title: "Apply an AI agent fix",
      description: `Overwrite the AI agent's live script with \`script\`. The previous script is kept; undo with sixtydb_call_analysis_undo_agent_fix. Needs the key's \`agents\` permission. Fails with 409 AGENT_CHANGED if the agent changed since the suggestion.

- \`base_hash\`: from sixtydb_call_analysis_suggest_agent_fix.
- \`confirm\` (boolean, default false): **Without \`confirm: true\` this tool does nothing and only explains the consequence.**
**Returns:** \`{ fix_id, agent, previous_script, new_hash }\`.`,
      inputSchema: CallAnalysisApplyAgentFixSchema,
      annotations: { title: "Apply agent fix", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params: CallAnalysisApplyAgentFixParams) => {
      if (params.confirm !== true) {
        return errorResult(
          `**Confirmation required - nothing was changed.**\n\n` +
          `This replaces the live script of the AI agent behind call \`${params.call_id}\`. The previous script is kept and can be restored with sixtydb_call_analysis_undo_agent_fix.\n\n` +
          `Call this tool again with \`confirm: true\` to proceed.`
        );
      }
      try {
        const res = await api().post<any>(`${BASE}/calls/${params.call_id}/agent-fix/apply`, { base_hash: params.base_hash, script: params.script });
        return respond(md("Agent fix applied", unwrap(res)), res, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );

  // ── undo_agent_fix ───────────────────────────────────
  server.registerTool(
    "sixtydb_call_analysis_undo_agent_fix",
    {
      title: "Undo an AI agent fix",
      description: `Restore the AI agent's previous script after sixtydb_call_analysis_apply_agent_fix. Needs the key's \`agents\` permission. 409 FIX_NOT_UNDOABLE / AGENT_CHANGED if the agent was edited since.

- \`confirm\` (boolean, default false): **Without \`confirm: true\` this tool does nothing and only explains the consequence.**`,
      inputSchema: CallAnalysisUndoAgentFixSchema,
      annotations: { title: "Undo agent fix", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params: CallAnalysisUndoAgentFixParams) => {
      if (params.confirm !== true) {
        return errorResult(
          `**Confirmation required - nothing was changed.**\n\n` +
          `This restores the AI agent's script from before fix \`${params.fix_id}\`.\n\n` +
          `Call this tool again with \`confirm: true\` to proceed.`
        );
      }
      try {
        const res = await api().post<any>(`${BASE}/calls/${params.call_id}/agent-fix/${params.fix_id}/undo`);
        return respond(md("Agent fix undone", unwrap(res)), res, params.response_format);
      } catch (error) {
        return handleCallAnalysisError(error);
      }
    }
  );
}
