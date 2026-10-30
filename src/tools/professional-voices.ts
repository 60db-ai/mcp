/**
 * Voice limit + professional voice tools (read-only)
 *
 * Backend routes (routes/index.js):
 *  - GET /voices/quota                                -> instant + professional voice limits of the workspace
 *  - GET /voices/professional/jobs                    -> my professional voices (+ professional quota)
 *  - GET /voices/professional/marketplace-eligibility -> plan / KYC / bank checklist for marketplace listing
 *
 * Creating a professional voice is not exposed: it needs a live recording for speaker
 * verification, which only the web app can capture.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VoiceReadOnlySchema, VoiceReadOnlyParams } from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import { formatErrorMessage, truncateIfNeeded } from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const MARKETPLACE_BLOCKER_TEXT: Record<string, string> = {
  plan_not_eligible: "Upgrade to the Creator or Pro plan",
  kyc_required: "Submit your KYC tax form (Payouts page)",
  kyc_expired: "Your KYC tax form expired: resubmit it (Payouts page)",
  bank_required: "Add bank details (Payouts page)",
  kyc_not_verified: "KYC must be verified before the voice goes live",
  bank_not_active: "Bank details must be active before the voice goes live",
};

function respond(markdown: string, json: unknown, format: ResponseFormat) {
  const body = format === ResponseFormat.JSON ? JSON.stringify(json, null, 2) : markdown;
  const { content } = truncateIfNeeded(body, format === ResponseFormat.JSON);
  return { content: [{ type: "text" as const, text: content }] };
}

function failed(error: unknown) {
  return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
}

const plan = (q: any) => `${q?.plan_slug ?? "no"} plan`;

function professionalLine(q: any): string {
  if (!q) return "- Professional voices: unknown";
  const status = q.can_create
    ? `can create ${q.remaining} more`
    : q.reason === "PVC_NOT_AVAILABLE_ON_PLAN"
      ? "not available on this plan; Creator includes 2, Pro 5"
      : "limit reached: delete one or upgrade";
  return `- Professional voices: ${q.used} of ${q.limit} used (${status})`;
}

export function registerProfessionalVoiceTools(server: McpServer): void {
  server.registerTool(
    "sixtydb_get_voice_quota",
    {
      title: "Get voice limits",
      description: `Show how many voices this workspace can create (\`GET /voices/quota\`).

- **Instant (cloned) voices**: 1 on Free/Starter/Flow, 10 on Creator/Pro, plus any bonus from support. Counts live voices; deleting one frees a slot.
- **Professional voices**: Creator 2, Pro 5, not available on other plans.

Call this before \`sixtydb_create_voice\` to avoid a \`403 VOICE_LIMIT_REACHED\`.

**Returns:** \`instant\` {limit, bonus, effective_limit, used, remaining, can_create} and \`professional\` {limit, used, remaining, can_create, reason}, each with \`plan_slug\` and \`upgrade_plans\`.`,
      inputSchema: VoiceReadOnlySchema,
      annotations: { title: "Get voice limits", ...READ_ONLY },
    },
    async (params: VoiceReadOnlyParams) => {
      try {
        const data = await getApiClient().get<any>("/voices/quota");
        const { instant, professional } = data?.data ?? {};
        const md = [
          `# Voice limits (${plan(instant)})`,
          "",
          `- Instant voices: ${instant?.used} of ${instant?.effective_limit} used` +
            (instant?.bonus ? ` (includes ${instant.bonus} bonus)` : "") +
            (instant?.can_create ? "" : " (limit reached: delete one or upgrade)"),
          professionalLine(professional),
        ].join("\n");
        return respond(md, data?.data, params.response_format);
      } catch (error) {
        return failed(error);
      }
    }
  );

  server.registerTool(
    "sixtydb_list_professional_voices",
    {
      title: "List my professional voices",
      description: `List your professional voice clones in this workspace with their status (\`GET /voices/professional/jobs\`).

Includes voices that are verifying, training, private, in marketplace review or live, plus ones rejected or failed in the last 30 days.
Statuses: \`pending_verify\`, \`queued\`, \`transcribing\`, \`embedding\`, \`training\`, \`private\` (ready, not listed), \`awaiting_approval\` (marketplace review), \`approved\` (live in marketplace), \`rejected\`, \`failed\`.

Professional voices are created in the web app (Voice Library → Professional voice), because they need a live recording for verification.

**Returns:** the voices (id, name, status, languages, list_in_marketplace, rejection reason, created_at) and the professional voice quota.`,
      inputSchema: VoiceReadOnlySchema,
      annotations: { title: "List professional voices", ...READ_ONLY },
    },
    async (params: VoiceReadOnlyParams) => {
      try {
        const data = await getApiClient().get<any>("/voices/professional/jobs");
        const jobs: any[] = data?.data ?? [];
        const rows = jobs.map((j) =>
          `| ${j.id} | ${j.name} | ${j.status} | ${(j.languages ?? []).join(", ")} | ${j.rejection_reason_text ?? ""} |`);
        const md = [
          `# Professional voices (${plan(data?.quota)})`,
          "",
          professionalLine(data?.quota),
          "",
          jobs.length
            ? ["| ID | Name | Status | Languages | Rejection reason |", "|---|---|---|---|---|", ...rows].join("\n")
            : "No professional voices yet. Create one in the web app: Voice Library → Professional voice.",
        ].join("\n");
        return respond(md, { voices: jobs, quota: data?.quota }, params.response_format);
      } catch (error) {
        return failed(error);
      }
    }
  );

  server.registerTool(
    "sixtydb_get_marketplace_eligibility",
    {
      title: "Check marketplace eligibility",
      description: `Check whether you can list a professional voice in the voice marketplace (\`GET /voices/professional/marketplace-eligibility\`).

Listing needs a **Creator or Pro** plan, a submitted **KYC** tax form and **bank details** (both on the web app's Payouts page).
- \`can_submit\`: you may submit a voice for marketplace review (KYC and bank details may still be under review).
- \`can_be_approved\`: KYC is verified and bank details are active, so an approved voice can go live.

**Returns:** plan_slug, kyc_status, payout_method_status, can_submit, can_be_approved, blocking (stops submitting) and approval_blocking (stops going live).`,
      inputSchema: VoiceReadOnlySchema,
      annotations: { title: "Marketplace eligibility", ...READ_ONLY },
    },
    async (params: VoiceReadOnlyParams) => {
      try {
        const data = await getApiClient().get<any>("/voices/professional/marketplace-eligibility");
        const e = data?.data ?? {};
        const blocking: string[] = e.blocking ?? [];
        // "verified / active" items repeat "submit KYC / add bank details" until those are filed.
        const covered = (c: string) =>
          (c === "kyc_not_verified" && blocking.some((b) => b.startsWith("kyc_"))) ||
          (c === "bank_not_active" && blocking.includes("bank_required"));
        const todo = [...blocking, ...(e.approval_blocking ?? []).filter((c: string) => !covered(c))];
        const md = [
          `# Marketplace eligibility (${plan(e)})`,
          "",
          `- KYC: ${e.kyc_status}`,
          `- Bank details: ${e.payout_method_status}`,
          `- Can submit for review: ${e.can_submit ? "yes" : "no"}`,
          `- Can go live once approved: ${e.can_be_approved ? "yes" : "no"}`,
          ...(todo.length ? ["", "**To do:**", ...todo.map((c) => `- ${MARKETPLACE_BLOCKER_TEXT[c] ?? c}`)] : []),
        ].join("\n");
        return respond(md, e, params.response_format);
      } catch (error) {
        return failed(error);
      }
    }
  );
}
