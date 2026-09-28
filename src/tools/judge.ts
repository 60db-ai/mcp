/**
 * Judge Tools
 *
 * Exposes 60db's Judge layer via MCP:
 *   - Evaluate content against a rubric of choice/score/noul questions
 *   - Extract intent, operation and entity spans from one conversational turn
 *   - Save and re-run rubrics
 *   - Browse run history, especially the low-confidence review queue
 *
 * Judge is a CLASSIFIER, not a generator. It never writes prose: every answer
 * is a probability distribution over an answer space the caller defined. That
 * is what makes results comparable across thousands of runs — you can average
 * a score, you cannot average a paragraph.
 *
 * Billed per input token. The upstream builds one row per question, each
 * carrying the shared content again, so a 10-question rubric encodes the
 * transcript ten times. Failed runs are refunded automatically.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  JudgeEvaluateSchema,
  JudgeExtractSchema,
  JudgeCreateRubricSchema,
  JudgeRubricIdSchema,
  JudgeListRunsSchema,
  JudgeRunIdSchema,
  JudgeUsageSchema,
  JudgeSimpleSchema,
  JudgeEvaluateParams,
  JudgeExtractParams,
  JudgeCreateRubricParams,
  JudgeRubricIdParams,
  JudgeListRunsParams,
  JudgeRunIdParams,
  JudgeUsageParams,
  JudgeSimpleParams,
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import { formatErrorMessage, truncateIfNeeded } from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

// ─ Local helpers ───────────────────────────────────────────

/** The upstream's own escalation line. Below it, a human should look. */
const REVIEW_LINE = 0.85;

/**
 * JSON is emitted COMPACT, not pretty-printed.
 *
 * Responses are cut at CHARACTER_LIMIT (25,000) and a truncation marker is
 * appended — which turns pretty-printed JSON into unparseable JSON. Indenting
 * inflates a run listing by about a third for no benefit to a machine reader:
 * a 50-row page is 31,346 characters pretty and 23,608 compact, i.e. broken
 * versus fine. Markdown, which a human reads, stays formatted.
 */
function respond(markdown: string, json: unknown, format: ResponseFormat) {
  const body = format === ResponseFormat.JSON ? JSON.stringify(json) : markdown;
  const { content } = truncateIfNeeded(body, format === ResponseFormat.JSON);
  return { content: [{ type: "text" as const, text: content }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const pct = (v: number | null | undefined) =>
  typeof v === "number" ? `${Math.round(v * 100)}%` : "—";

const usd = (v: number | null | undefined) =>
  typeof v === "number" ? `$${v.toFixed(8)}` : "—";

/** Render one answer, distribution included — the spread IS the answer. */
function fmtAnswer(id: string, a: any): string {
  const lines: string[] = [];
  const flagged = typeof a.confidence === "number" && a.confidence < REVIEW_LINE;

  if (a.type === "choice") {
    lines.push(`**${id}** → \`${a.choice}\` (${pct(a.confidence)} confident)${flagged ? " ⚠️" : ""}`);
  } else if (a.type === "score") {
    const levels = Object.keys(a.legend || {}).length;
    lines.push(`**${id}** → **${a.score?.toFixed(2)}** of ${Math.max(levels - 1, 1)} (${pct(a.confidence)} confident)${flagged ? " ⚠️" : ""}`);
  } else {
    // noul reports a raw probability of true and carries NO confidence field.
    lines.push(`**${id}** → ${pct(a.noul)} true _(probability, not a confidence)_`);
  }

  const ranked = Object.entries(a.probabilities || {}).sort(
    (x, y) => (y[1] as number) - (x[1] as number),
  );
  for (const [label, value] of ranked) {
    // For a score the keys are level indices — say what each one means.
    const name = a.type === "score" && a.legend?.[label] ? `${label} · ${a.legend[label]}` : label;
    lines.push(`  - ${name}: ${pct(value as number)}`);
  }
  return lines.join("\n");
}

function fmtEvaluate(d: any): string {
  const out: string[] = [];
  out.push(`### Answers`);
  out.push(
    `\`${d.model}\` · ${d.latency_ms}ms · ${d.usage?.input_tokens ?? 0} input tokens · ${usd(d.credits_charged)}` +
      (d.escalated_questions ? ` · ${d.escalated_questions} escalated` : ""),
  );
  out.push("");
  for (const [id, a] of Object.entries(d.answers || {})) out.push(fmtAnswer(id, a), "");
  if (typeof d.min_confidence === "number" && d.min_confidence < REVIEW_LINE) {
    out.push(`⚠️ Lowest confidence **${pct(d.min_confidence)}** — below the ${REVIEW_LINE} review line. Worth a human check before acting on it.`);
  }
  out.push(d.id ? `\nRun \`${d.id}\`` : `\n_Not saved to history (save: false)._`);
  return out.join("\n");
}

function fmtExtract(d: any): string {
  const out: string[] = [`### Turn classified (v${d.version})`];
  for (const [label, v] of [["Intent", d.intent], ["Operation", d.operation], ["Response path", d.response_path]] as const) {
    if (!v) continue;
    const flagged = v.confidence < REVIEW_LINE;
    out.push(`- **${label}**: \`${v.label}\` (${pct(v.confidence)})${flagged ? " ⚠️" : ""}`);
  }
  out.push("", `**Entities** (offsets are Unicode code points, not UTF-16 indices):`);
  if (!d.entities?.length) out.push("_none found_");
  for (const e of d.entities || []) {
    out.push(`- \`${e.label}\` → **${e.text}** \`[${e.start},${e.end})\` ${pct(e.confidence)}`);
  }
  out.push("", `${d.latency_ms}ms · ${usd(d.credits_charged)}${d.id ? ` · run \`${d.id}\`` : ""}`);
  return out.join("\n");
}

function fmtRunLine(r: any): string {
  const summary = Object.entries(r.summary || {})
    .map(([k, v]) => `${k}: ${typeof v === "number" ? Number((v as number).toFixed(2)) : v}`)
    .join(" · ");
  const flag = typeof r.min_confidence === "number" && r.min_confidence < REVIEW_LINE ? " ⚠️" : "";
  return `- \`${r.id}\` **${r.kind}**${flag} — ${summary || "no answers"} _(${pct(r.min_confidence)}, ${usd(r.credits_charged)})_`;
}

// ─ Registration ────────────────────────────────────────────

export function registerJudgeTools(server: McpServer): void {
  // ── sixtydb_judge_evaluate ─────────────────────────────
  server.registerTool(
    "sixtydb_judge_evaluate",
    {
      title: "Evaluate content against a rubric",
      description: `Score any content against questions **you** define, and get a probability distribution per question. This is a classifier, not a generator — it cannot invent a category, ramble, or return prose you have to parse.

Use it when you need a **number you can average, sort or threshold**: scoring call transcripts, triaging tickets, grading a generated answer against its source.

**Three question types** (the shape of \`criteria\` changes with each):
- \`choice\` — pick one of your options. \`criteria\` is a map of option name → description. Returns the winner plus a probability for every option.
- \`score\` — rate on your ladder. \`criteria\` is an ordered array, **lowest first**, max 10. Returns a probability-weighted position like \`1.87\` — **not** an index.
- \`noul\` — true/false. Returns a raw probability of true, with **no confidence field** (by design — it is not a calibrated correctness estimate).

**Parameters:**
- \`state\` (required): the content every question is asked about. Text or any JSON. Each question sees this and nothing else — they are independent, not a conversation.
- \`questions\`: map of answer key → question, max 32. **Or** \`rubric_id\` to run a saved rubric. Never both.
- \`model\`, \`label\`, \`save\` (set false to bill without storing history).

**Always include an \`unknown\` option on a choice.** Without an escape hatch the model must pick one of your real labels even on off-topic content.

**Descriptions are what the model reads** — they are the thing to tune. A label with a vague description produces vague answers.

**Returns:** one answer per question with its full distribution, the lowest confidence across the set, token usage and the charge.

**Anything under 0.85 confidence should go to a human** — that is the upstream's own escalation threshold, and what \`sixtydb_judge_list_runs\` with \`needs_review\` surfaces.

**Example:**
\`\`\`json
{
  "state": "Agent: I can't refund that. Caller: This is the third time I've called.",
  "questions": {
    "tone": { "type": "choice", "instructions": "How did the agent come across?",
              "criteria": { "professional": "Calm and courteous",
                            "dismissive": "Brushes the caller off",
                            "unknown": "Not clear from the transcript" } },
    "satisfaction": { "type": "score", "criteria": ["Angry", "Unhappy", "Neutral", "Satisfied"] },
    "resolved": { "type": "noul", "instructions": "Was the problem solved?" }
  }
}
\`\`\`

**Cost:** billed per input token. The shared content is re-encoded **once per question**, so a 10-question rubric costs ten times the transcript. Keep rubrics tight on long content.

**Error Handling:**
- 400: invalid rubric — the message names the offending question. Also returned if the content exceeds the model's 8K-token-per-question context.
- 402: insufficient credits (the shortfall is reported)
- 404: unknown \`rubric_id\`
- 429 / 503: the judge is busy or unavailable — retry. The charge is refunded automatically.`,
      inputSchema: JudgeEvaluateSchema,
      annotations: {
        title: "Evaluate with a rubric",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: JudgeEvaluateParams) => {
      try {
        if (params.questions && params.rubric_id) {
          return errorResult("Provide either `questions` or `rubric_id`, not both.");
        }
        if (!params.questions && !params.rubric_id) {
          return errorResult("Provide `questions` (a rubric) or `rubric_id` (a saved one).");
        }
        const { response_format, ...body } = params;
        const apiClient = getApiClient();
        const data = await apiClient.post<any>("/judge/evaluate", body);
        if (!data?.success) {
          return respond(`**Evaluation failed**: ${data?.message || "unknown"}`, data, response_format);
        }
        return respond(fmtEvaluate(data.data || {}), data, response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_extract ──────────────────────────────
  server.registerTool(
    "sixtydb_judge_extract",
    {
      title: "Classify a turn and extract entities",
      description: `Label one conversational turn with an intent and an operation, and pull the values out of it with their exact positions. This is the understanding layer for a voice or chat agent — what did they just ask for, and what values did they give me.

**Parameters:**
- \`text\` (required, max 2,048 Unicode code points): the turn.
- \`schema\` (required): \`intents\` and \`operations\` are required label maps; \`entities\` and \`responsePaths\` are optional. Each is a map of label name → description.
- \`profile\` ('generic' | 'medical'), \`budget_ms\` (1–30000), \`save\`, \`label\`.

Supplying \`responsePaths\` selects the **v2** model, which also returns how the agent should reply.

The mandatory \`unknown\` label is **added server-side** if you leave it out, so you do not have to remember it.

**Returns:** intent, operation, optional response path — each with a confidence — plus entity spans.

⚠️ **Entity \`start\`/\`end\` are Unicode CODE POINT offsets**, not UTF-16 indices. Slice with \`Array.from(text).slice(start, end)\`; a plain \`text.slice()\` lands in the wrong place as soon as the turn contains an emoji.

**Example:**
\`\`\`json
{
  "text": "can you move my 10am appointment to friday",
  "schema": {
    "intents":    { "booking": "Wants to arrange or change a booking" },
    "operations": { "reschedule": "Move an existing booking to a new time" },
    "entities":   { "date": "A calendar date", "time": "A clock time" }
  }
}
\`\`\`

**Cost:** billed per input token — a single short turn is a fraction of a cent.

**Error Handling:**
- 400: text too long, or a label map missing/invalid
- 402: insufficient credits
- 429 / 503 / 504: busy, unavailable, or the request budget expired — all refunded`,
      inputSchema: JudgeExtractSchema,
      annotations: {
        title: "Extract from a turn",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: JudgeExtractParams) => {
      try {
        const { response_format, ...body } = params;
        const apiClient = getApiClient();
        const data = await apiClient.post<any>("/judge/extract", body);
        if (!data?.success) {
          return respond(`**Extraction failed**: ${data?.message || "unknown"}`, data, response_format);
        }
        return respond(fmtExtract(data.data || {}), data, response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_list_models ──────────────────────────
  server.registerTool(
    "sixtydb_judge_list_models",
    {
      title: "List judge models",
      description: `Model names \`sixtydb_judge_evaluate\` accepts on this deployment.

**Do not hardcode model names** — this list is authoritative and changes when the judge deployment changes. Call it before offering the user a choice.

**Returns:** each model's name, description and release date.`,
      inputSchema: JudgeSimpleSchema,
      annotations: { title: "List models", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: JudgeSimpleParams) => {
      try {
        const data = await getApiClient().get<any>("/judge/models");
        if (!data?.success) return respond(`**Failed**: ${data?.message}`, data, params.response_format);
        const models = data.data?.models || [];
        const md = ["### Judge models", ...models.map((m: any) => `- \`${m.name}\` — ${m.description}`)].join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_list_rubrics ─────────────────────────
  server.registerTool(
    "sixtydb_judge_list_rubrics",
    {
      title: "List saved rubrics",
      description: `Rubrics you can run: your own, plus every rubric shared with the workspace.

Use this before \`sixtydb_judge_evaluate\` when the user refers to a rubric by name rather than supplying questions.

**Returns:** id, name, question count, whether it is shared, and its default model.`,
      inputSchema: JudgeSimpleSchema,
      annotations: { title: "List rubrics", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: JudgeSimpleParams) => {
      try {
        const data = await getApiClient().get<any>("/judge/rubrics");
        if (!data?.success) return respond(`**Failed**: ${data?.message}`, data, params.response_format);
        const rubrics = data.data || [];
        if (!rubrics.length) {
          return respond("_No saved rubrics yet._ Create one with `sixtydb_judge_create_rubric`.", data, params.response_format);
        }
        const md = ["### Saved rubrics", ...rubrics.map((r: any) =>
          `- \`${r.id}\` **${r.name}** — ${r.question_count} question(s)${r.shared ? ", shared" : ""}${r.description ? ` · ${r.description}` : ""}`)].join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_create_rubric ────────────────────────
  server.registerTool(
    "sixtydb_judge_create_rubric",
    {
      title: "Save a rubric",
      description: `Save a set of questions so they can be re-run by id instead of rebuilt each time.

Saving matters for consistency: everyone scoring against the same saved rubric produces comparable numbers, whereas everyone writing their own questions does not.

**Parameters:**
- \`name\` (required, unique per workspace), \`questions\` (required, same shape as \`sixtydb_judge_evaluate\`)
- \`description\`, \`model\`
- \`shared\`: publish to the whole workspace. **Owner/admin only** — a member gets 403.

Questions are validated with the same rules as a live run, so a rubric that saves is a rubric that runs.

**Error Handling:**
- 400: invalid questions — the message names the offending one
- 403: \`shared: true\` requires owner/admin
- 409: a rubric with that name already exists in this workspace`,
      inputSchema: JudgeCreateRubricSchema,
      annotations: { title: "Save rubric", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: JudgeCreateRubricParams) => {
      try {
        const { response_format, ...body } = params;
        const data = await getApiClient().post<any>("/judge/rubrics", body);
        if (!data?.success) return respond(`**Save failed**: ${data?.message}`, data, response_format);
        const r = data.data || {};
        return respond(
          `✅ Rubric saved: **${r.name}**\n\n- id: \`${r.id}\`\n- ${r.question_count} question(s)\n- ${r.shared ? "shared with the workspace" : "private to you"}\n\nRun it with \`sixtydb_judge_evaluate\` using \`rubric_id: "${r.id}"\`.`,
          data, response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_delete_rubric ────────────────────────
  server.registerTool(
    "sixtydb_judge_delete_rubric",
    {
      title: "Delete a saved rubric",
      description: `Soft-delete a rubric. Past runs keep their link to it, so history stays readable after the rubric is gone.

**Error Handling:**
- 403: you can only delete your own rubric unless you are owner/admin
- 404: no such rubric in this workspace`,
      inputSchema: JudgeRubricIdSchema,
      annotations: { title: "Delete rubric", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: JudgeRubricIdParams) => {
      try {
        const data = await getApiClient().delete<any>(`/judge/rubrics/${encodeURIComponent(params.rubric_id)}`);
        if (!data?.success) return respond(`**Delete failed**: ${data?.message}`, data, params.response_format);
        return respond(`✅ Rubric \`${params.rubric_id}\` deleted. Past runs remain readable.`, data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_list_runs ────────────────────────────
  server.registerTool(
    "sixtydb_judge_list_runs",
    {
      title: "List judge runs / the review queue",
      description: `Judge history, newest first.

**\`needs_review: true\` is the most useful call here** — it returns only runs where the judge's lowest confidence fell below 0.85, the upstream's own escalation line. That is the queue a person should actually work through, rather than re-reading everything the model was confident about.

**Parameters:**
- \`needs_review\` (boolean), \`kind\` ('evaluate' | 'extract'), \`rubric_id\`, \`limit\` (max 100), \`offset\`

**Visibility:** you see your own runs; workspace owners and admins see everyone's. A run stores the content it judged, so it is not workspace-public by default.

**Returns:** id, kind, the headline answer per question, lowest confidence and cost.

**Large pages:** responses are capped at 25,000 characters. A page big enough to exceed that is truncated with a note — lower \`limit\` and page with \`offset\` rather than asking for everything at once.`,
      inputSchema: JudgeListRunsSchema,
      annotations: { title: "List runs", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: JudgeListRunsParams) => {
      try {
        const query: Record<string, any> = { limit: params.limit, offset: params.offset };
        if (params.kind) query.kind = params.kind;
        if (params.rubric_id) query.rubric_id = params.rubric_id;
        if (params.needs_review) query.needs_review = "true";
        const data = await getApiClient().get<any>("/judge/evaluations", query);
        if (!data?.success) return respond(`**Failed**: ${data?.message}`, data, params.response_format);
        const runs = data.data || [];
        const total = data.pagination?.total ?? runs.length;
        if (!runs.length) {
          return respond(params.needs_review
            ? "_Nothing below the review line._ Every answer came back confident."
            : "_No runs yet._", data, params.response_format);
        }
        const head = params.needs_review ? `### Needs review (${total})` : `### Judge runs (${total})`;
        return respond([head, ...runs.map(fmtRunLine)].join("\n"), data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_get_run ──────────────────────────────
  server.registerTool(
    "sixtydb_judge_get_run",
    {
      title: "Get one judge run",
      description: `One run in full — the content that was judged, the exact request sent, and the complete answer with every probability.

Use this when reviewing a flagged run from \`sixtydb_judge_list_runs\`, or to explain to a user why a particular score came out the way it did.

**Error Handling:**
- 404: no such run, or it belongs to someone else (history is private to whoever ran it; owner/admin see all)`,
      inputSchema: JudgeRunIdSchema,
      annotations: { title: "Get run", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: JudgeRunIdParams) => {
      try {
        const data = await getApiClient().get<any>(`/judge/evaluations/${encodeURIComponent(params.run_id)}`);
        if (!data?.success) return respond(`**Failed**: ${data?.message}`, data, params.response_format);
        const d = data.data || {};
        const out = [`### Run \`${d.id}\` (${d.kind})`, `_${d.created_at}_`, ""];
        if (d.state_preview) out.push(`> ${String(d.state_preview).slice(0, 400)}`, "");
        if (d.result?.answers) {
          for (const [id, a] of Object.entries(d.result.answers)) out.push(fmtAnswer(id, a), "");
        } else {
          out.push("```json", JSON.stringify(d.summary, null, 2), "```", "");
        }
        out.push(`${usd(d.credits_charged)} · ${d.input_tokens} input tokens · ${d.latency_ms}ms`);
        return respond(out.join("\n"), data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_delete_run ───────────────────────────
  server.registerTool(
    "sixtydb_judge_delete_run",
    {
      title: "Delete a judge run",
      description: `Remove a run from history. Runs store the content they judged, so this is how a user gets that content out of the workspace record.

**Error Handling:**
- 403: you can only delete your own runs unless you are owner/admin
- 404: no such run`,
      inputSchema: JudgeRunIdSchema,
      annotations: { title: "Delete run", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: JudgeRunIdParams) => {
      try {
        const data = await getApiClient().delete<any>(`/judge/evaluations/${encodeURIComponent(params.run_id)}`);
        if (!data?.success) return respond(`**Delete failed**: ${data?.message}`, data, params.response_format);
        return respond(`✅ Run \`${params.run_id}\` deleted.`, data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_usage ────────────────────────────────
  server.registerTool(
    "sixtydb_judge_usage",
    {
      title: "Judge spend and run counts",
      description: `Net Judge spend for a period, broken down by service type, plus saved-run counts by kind.

Refunds are already netted off — a failed run costs nothing, and shows as a charge and a matching refund.

**Parameters:** \`period\` — 'current_month' (default), 'last_30_days' or 'all_time'.`,
      inputSchema: JudgeUsageSchema,
      annotations: { title: "Judge usage", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: JudgeUsageParams) => {
      try {
        const data = await getApiClient().get<any>("/judge/usage", { period: params.period });
        if (!data?.success) return respond(`**Failed**: ${data?.message}`, data, params.response_format);
        const d = data.data || {};
        const out = [
          `### Judge usage — ${String(d.period).replace(/_/g, " ")}`,
          `**${usd(d.total?.net_spend_usd)}** net · ${d.total?.operations ?? 0} billed · ${d.total?.refunds ?? 0} refunded`,
          "",
        ];
        for (const [service, v] of Object.entries<any>(d.by_service || {})) {
          out.push(`- \`${service}\` — ${usd(v.net_spend_usd)} across ${v.operation_count} op(s), ${v.gross_units} token(s)`);
        }
        for (const [kind, v] of Object.entries<any>(d.by_kind || {})) {
          out.push(`- _${kind}_: ${v.runs} saved run(s), ${v.questions} question(s)`);
        }
        return respond(out.join("\n"), data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_judge_health ───────────────────────────────
  server.registerTool(
    "sixtydb_judge_health",
    {
      title: "Judge service health",
      description: `Whether the judge's upstream model is reachable and ready, which upstream this deployment points at, and the circuit-breaker state.

Useful when evaluations are failing: it distinguishes "the service is down" from "your rubric is wrong".

**Requires owner/admin** — it exposes deployment internals.`,
      inputSchema: JudgeSimpleSchema,
      annotations: { title: "Judge health", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: JudgeSimpleParams) => {
      try {
        const data = await getApiClient().get<any>("/judge/health");
        if (!data?.success) return respond(`**Failed**: ${data?.message}`, data, params.response_format);
        const d = data.data || {};
        const md = [
          `### Judge health`,
          `- upstream: \`${d.upstream_url}\``,
          `- ready: ${d.upstream?.ready ? "✅ yes" : "❌ no"}`,
          `- configured: ${d.configured ? "✅ yes" : "❌ no — JEV_API_KEY is unset"}`,
          `- circuit breaker: \`${d.circuit_breaker?.state}\``,
        ].join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );
}
