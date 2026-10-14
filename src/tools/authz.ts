/**
 * Authorization (Cerbos) Tools
 *
 * 60db's access control is enforced server-side by Cerbos, a
 * policy-based authorization engine. Every /api request is gated by a
 * Cerbos policy check before reaching the controller.
 *
 * These tools let an agent:
 *   1. Fetch the full permission map for the current user/workspace so
 *      the agent knows which actions will succeed and which will be
 *      denied by policy (before spending latency on a request that will
 *      just return 403).
 *   2. Probe a specific (resource, action) without making the actual
 *      API call — useful for conditional workflows.
 *
 * Both tools are unbilled.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AuthzPermissionsSchema,
  AuthzCheckSchema,
  AuthzPermissionsParams,
  AuthzCheckParams,
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import { formatErrorMessage, truncateIfNeeded } from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

function respond(markdown: string, json: unknown, format: ResponseFormat) {
  const body = format === ResponseFormat.JSON
    ? JSON.stringify(json, null, 2)
    : markdown;
  const { content } = truncateIfNeeded(body, format === ResponseFormat.JSON);
  return { content: [{ type: "text" as const, text: content }] };
}

export function registerAuthzTools(server: McpServer): void {
  // ── sixtydb_get_permissions ─────────────────────────────
  server.registerTool(
    "sixtydb_get_permissions",
    {
      title: "Get my permissions",
      description: `Return the full Cerbos permission map for the current user in the current workspace.

Every action on 60db — TTS synthesis, STT transcription, voice cloning, memory ingest, billing management, workspace invites — is gated by a policy rule evaluated against your workspace role (\`owner\`, \`admin\`, \`developer\`, \`member\`, \`viewer\`) and your plan tier.

Use this tool **before** attempting a destructive or gated action to check whether it will succeed. Example workflow:

1. Call \`sixtydb_get_permissions\` once per session to cache the map
2. Check \`permissions.memory.create\` before offering a "save to memory" button
3. Check \`permissions.workspace["billing:manage"]\` before showing top-up UI (credit top-ups are available on the Creator and Pro plans only)
4. Hide features the role can't use rather than letting the user click and get a 403

**Returns:**
- \`role\` — the caller's workspace role
- \`tier\` — the workspace plan tier
- \`credit_balance\` — current wallet balance (informational)
- \`plan_active\` — whether the subscription is active
- \`permissions\` — nested \`{resource: {action: boolean}}\` map

**Unbilled** — this is a policy query, not a memory operation.`,
      inputSchema: AuthzPermissionsSchema,
      annotations: {
        title: "Get permissions",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: AuthzPermissionsParams) => {
      try {
        const data = await getApiClient().get<any>("/authz/permissions");
        if (!data?.success) {
          return respond(
            `**Failed to fetch permissions**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const p = data.data || {};
        const perms = p.permissions || {};
        const resourceLines: string[] = [];
        for (const resource of Object.keys(perms).sort()) {
          const actions = Object.entries(perms[resource] || {})
            .filter(([, allowed]) => allowed === true)
            .map(([action]) => action);
          if (actions.length > 0) {
            resourceLines.push(`- **${resource}**: ${actions.join(", ")}`);
          }
        }
        const md = [
          `**Permissions** for role \`${p.role || "unknown"}\` (tier: \`${p.tier || "unknown"}\`)`,
          p.plan_active === false ? `⚠️  Plan inactive — some features may be restricted` : null,
          p.credit_balance != null ? `Workspace Wallet: **$${Number(p.credit_balance).toFixed(4)}**` : null,
          "",
          "**Allowed actions**:",
          ...resourceLines,
        ].filter(Boolean).join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );

  // ── sixtydb_check_permission ────────────────────────────
  server.registerTool(
    "sixtydb_check_permission",
    {
      title: "Check a single permission",
      description: `Probe whether the current user is allowed to perform a specific (resource, action) in the current workspace.

This is a local check against the permission map returned by \`sixtydb_get_permissions\` (the tool fetches the map under the hood). If the map hasn't been fetched yet, it fetches once and caches for the session.

**Parameters:**
- \`resource\` (string, required): Resource kind — one of:
  - \`memory\` — memory/RAG operations
  - \`tts\`, \`stt\` — voice synthesis/transcription
  - \`voices\` — voice library and cloning
  - \`workspace\` — workspace-level actions (invite, billing, delete)
  - \`billing\` — top-up (Creator and Pro only), subscription management
  - \`developer_api\` — API key management
  - \`analytics\` — usage analytics
  - \`platform\` — superadmin actions
- \`action\` (string, required): Specific action under that resource
  - Memory examples: \`create\`, \`search\`, \`delete\`, \`list\`, \`export\`
  - Workspace examples: \`members:invite\`, \`billing:manage\`, \`delete\`
  - TTS/STT examples: \`synthesize\`, \`transcribe\`

**Returns** a boolean + the role/tier context so the agent can decide whether to attempt the action.

**Use this before:**
- Offering UI features that require specific roles
- Batching operations (skip the ones that will 403)
- Prompting the user to upgrade their role
- Deciding whether to offer a credit top-up before a billable op (Creator and Pro only)`,
      inputSchema: AuthzCheckSchema,
      annotations: {
        title: "Check permission",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: AuthzCheckParams) => {
      try {
        const data = await getApiClient().get<any>("/authz/permissions");
        if (!data?.success) {
          return respond(
            `**Failed to check permission**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const p = data.data || {};
        const perms = p.permissions || {};
        const resourceMap = perms[params.resource] || {};
        // Explicit true → allowed; explicit false → denied; undefined → not in map (treat as unknown-deny).
        const explicit = resourceMap[params.action];
        const allowed = explicit === true;
        const result = {
          resource: params.resource,
          action: params.action,
          allowed,
          role: p.role || null,
          tier: p.tier || null,
          plan_active: p.plan_active ?? null,
          reason: explicit === undefined
            ? "Action not defined in policy — treat as denied"
            : allowed
              ? "Allowed by policy"
              : "Denied by policy for this role/tier",
        };
        const md = [
          `**Permission check**: \`${params.resource}:${params.action}\``,
          `Result: ${allowed ? "✅ **ALLOWED**" : "❌ **DENIED**"}`,
          `Role: \`${p.role || "unknown"}\``,
          `Reason: ${result.reason}`,
        ].join("\n");
        return respond(md, result, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );
}
