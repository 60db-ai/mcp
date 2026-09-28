/**
 * Workspace Management Tools
 * Tools for workspace operations
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  WorkspaceListSchema,
  WorkspaceGetSchema,
  WorkspaceCreateSchema,
  WorkspaceMembersSchema
} from "../schemas/index.js";
import {
  WorkspaceListParams,
  WorkspaceGetParams,
  WorkspaceCreateParams,
  WorkspaceMembersParams
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import {
  formatWorkspace,
  formatWorkspaceList,
  formatWorkspaceMember,
  truncateIfNeeded,
  formatErrorMessage
} from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

/**
 * Register workspace tools
 */
export function registerWorkspaceTools(server: McpServer): void {
  // List workspaces
  server.registerTool(
    "sixtydb_list_workspaces",
    {
      title: "List Workspaces",
      description: `List all workspaces accessible to the authenticated user.

This tool retrieves all workspaces where the user is a member, including owned workspaces and shared workspaces with various permission levels.

**Parameters:**
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For Markdown format (default):
- List of all workspaces with names and IDs
- Shows ownership and creation dates

For JSON format:
{
  "workspaces": [
    {
      "id": number,              // Numeric workspace ID
      "hash_id": string,         // Workspace hash ID
      "name": string,            // Workspace name
      "role": string,            // Your role in this workspace
      "owner_name": string,      // Workspace owner's display name
      "created_at": string       // Creation timestamp
    }
  ],
  "total": number               // Total number of workspaces
}

**Examples:**
- List all workspaces: {}

**Use Cases:**
- Switch between workspaces
- Check available workspaces
- Find workspace IDs for other operations
- Review workspace permissions

**Error Handling:**
- Returns "Error: Authentication required" if API key/JWT is invalid`,
      inputSchema: WorkspaceListSchema,
      annotations: {
        title: "List Workspaces",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: WorkspaceListParams) => {
      try {
        const apiClient = getApiClient();

        // GET /workspaces returns { success, message, data: [...] } — not a bare array.
        const response = await apiClient.get<{ data: unknown[] }>("/workspaces");
        const workspaces = response.data || [];

        const formatted = formatWorkspaceList(workspaces as any, params.response_format);

        const { content } = truncateIfNeeded(
          formatted,
          params.response_format === ResponseFormat.JSON
        );

        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: formatErrorMessage(error as Error)
          }]
        };
      }
    }
  );

  // Get workspace details
  server.registerTool(
    "sixtydb_get_workspace",
    {
      title: "Get Workspace Details",
      description: `Get detailed information about a specific workspace.

There is no dedicated "get one workspace" endpoint on the 60db API — this tool fetches the full list (GET /workspaces) and returns the entry matching the given id.

**Parameters:**
- id (string, required): Workspace id (numeric) or hash_id, as returned by sixtydb_list_workspaces
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For JSON format:
{
  "id": number,            // Numeric workspace ID
  "hash_id": string,       // Workspace hash ID
  "name": string,          // Workspace name
  "role": string,          // Your role in this workspace
  "owner_name": string,    // Workspace owner's display name
  "created_at": string     // Creation timestamp
}

**Examples:**
- Get workspace details: { "id": "12" }

**Use Cases:**
- Review workspace information
- Verify workspace access
- Get workspace metadata

**Error Handling:**
- Returns "Error: Workspace not found" if no workspace with this id/hash_id is in your workspace list`,
      inputSchema: WorkspaceGetSchema,
      annotations: {
        title: "Get Workspace Details",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: WorkspaceGetParams) => {
      try {
        const apiClient = getApiClient();

        // No GET /workspaces/:id route exists — filter the list instead.
        const response = await apiClient.get<{ data: any[] }>("/workspaces");
        const workspaces = response.data || [];
        const workspace = workspaces.find(
          (w) => String(w.id) === params.id || w.hash_id === params.id
        );

        if (!workspace) {
          return {
            content: [{
              type: "text",
              text: `**Error**: Workspace not found. "${params.id}" did not match any id or hash_id in your workspace list (use sixtydb_list_workspaces to see available workspaces).`
            }]
          };
        }

        const formatted = formatWorkspace(workspace, params.response_format);

        const { content } = truncateIfNeeded(
          formatted,
          params.response_format === ResponseFormat.JSON
        );

        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: formatErrorMessage(error as Error)
          }]
        };
      }
    }
  );

  // Create workspace
  server.registerTool(
    "sixtydb_create_workspace",
    {
      title: "Create Workspace",
      description: `Create a new workspace for team collaboration.

This tool creates a new workspace where the authenticated user becomes the owner. Workspaces allow teams to share voices, transcriptions, and resources.

**Parameters:**
- name (string, required): Name for the workspace (1-100 characters)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Note:** The API only stores a \`name\` — there is no description field on workspaces.

**Returns:**
For JSON format:
{
  "id": number,              // New workspace ID
  "hash_id": string,         // Workspace hash ID
  "name": string,            // Workspace name
  "role": "owner",           // Creator's role
  "created_at": string       // Creation timestamp
}

**Examples:**
- Create workspace: { "name": "Marketing Team" }

**Use Cases:**
- Create team-specific workspaces
- Organize voices by project/team
- Separate development and production resources

**Important Notes:**
- The creator becomes the workspace owner
- Owner can invite members and assign roles
- Workspaces are isolated - resources don't overlap

**Error Handling:**
- Returns "Error: Workspace name already exists" if name is not unique
- Returns "Error: Authentication required" if API key/JWT is invalid`,
      inputSchema: WorkspaceCreateSchema,
      annotations: {
        title: "Create Workspace",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: WorkspaceCreateParams) => {
      try {
        const apiClient = getApiClient();

        const requestBody = { name: params.name };

        // POST /workspaces returns { success, message, data: {...} }.
        const response = await apiClient.post<{ data: unknown }>("/workspaces", requestBody);

        const formatted = formatWorkspace(response.data as any, params.response_format);

        const { content } = truncateIfNeeded(
          formatted,
          params.response_format === ResponseFormat.JSON
        );

        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: formatErrorMessage(error as Error)
          }]
        };
      }
    }
  );

  // Get workspace members
  server.registerTool(
    "sixtydb_get_workspace_members",
    {
      title: "Get Workspace Members",
      description: `List all members of a workspace with their roles.

This tool retrieves all members of a specific workspace along with their roles (owner, admin, developer, member, viewer) and user details.

**Parameters:**
- workspace_id (string, required): Workspace ID
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For Markdown format (default):
- List of members with roles and details
- Shows user names, emails, and join dates

For JSON format:
{
  "members": [
    {
      "user_id": number,         // User ID
      "full_name": string,       // User name
      "email": string,           // User email
      "avatar_url": string | null,
      "role": string,            // Role: owner|admin|developer|member|viewer
      "joined_at": string,       // Join timestamp
      "is_active": boolean
    }
  ],
  "total": number               // Total number of members
}

**Role Permissions:**
- **owner**: Full control, can delete workspace
- **admin**: Can manage members and resources
- **developer**: Can create and edit resources
- **member**: Can use resources, limited editing
- **viewer**: Read-only access

**Examples:**
- Get workspace members: { "workspace_id": "workspace_abc123" }

**Use Cases:**
- Check who has access to workspace
- Review member roles and permissions
- Audit workspace membership
- Find members to invite or remove

**Error Handling:**
- Returns "Error: Workspace not found" if workspace doesn't exist (404 status)
- Returns "Error: Access denied" if user lacks permission (403 status)`,
      inputSchema: WorkspaceMembersSchema,
      annotations: {
        title: "Get Workspace Members",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: WorkspaceMembersParams) => {
      try {
        const apiClient = getApiClient();

        // GET /workspaces/:id/members returns { success, message, data: [...] }.
        const response = await apiClient.get<{ data: unknown[] }>(
          `/workspaces/${params.workspace_id}/members`
        );
        const members = response.data || [];

        const lines: string[] = [];
        lines.push(`# Workspace Members (${members.length})`);
        lines.push("");

        if (params.response_format === ResponseFormat.JSON) {
          const response = { members, total: members.length };
          const formatted = JSON.stringify(response, null, 2);

          const { content } = truncateIfNeeded(formatted, true);

          return {
            content: [{
              type: "text",
              text: content
            }]
          };
        }

        // Markdown format
        for (const member of members as any) {
          lines.push(formatWorkspaceMember(member, params.response_format));
          lines.push("");
        }

        const { content } = truncateIfNeeded(lines.join("\n"), false);

        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: formatErrorMessage(error as Error)
          }]
        };
      }
    }
  );
}
