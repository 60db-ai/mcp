/**
 * 60DB Tools
 * Tools for 60DB dictionary, snippets, and notes management
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DictionaryListSchema,
  DictionaryAddSchema,
  SnippetsListSchema,
  SnippetAddSchema,
  NotesListSchema,
  NoteAddSchema,
  NoteGetSchema
} from "../schemas/index.js";
import {
  DictionaryListParams,
  DictionaryAddParams,
  SnippetsListParams,
  SnippetAddParams,
  NotesListParams,
  NoteAddParams,
  NoteGetParams
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import {
  formatDictionaryEntry,
  formatSnippet,
  formatNote,
  truncateIfNeeded,
  formatErrorMessage
} from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

/**
 * Register 60DB tools
 */
export function register60DBTools(server: McpServer): void {
  // List dictionary entries
  server.registerTool(
    "sixtydb_60db_list_dictionary",
    {
      title: "List 60DB Dictionary Entries",
      description: `List pronunciation dictionary entries.

The 60DB dictionary allows you to define custom term replacements for better transcription accuracy. This is useful for names, technical terms, acronyms, and industry-specific vocabulary. \`scope=all\` (default) returns your personal entries plus your workspace's team entries in a single unfiltered list (no pagination or search on this endpoint).

**Parameters:**
- scope ('personal' | 'team' | 'all', optional): Filter by entry scope (default: 'all')
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For JSON format:
{
  "total": number,           // Number of entries returned
  "entries": [                // Array of dictionary entries
    {
      "id": string,          // Entry ID (hash_id)
      "term": string,        // Original term/phrase to replace
      "replacement": string, // Replacement text
      "tag": string | null,  // Optional label
      "scope": "personal" | "team",
      "createdBy": number,   // User ID that created the entry
      "createdAt": string    // Creation timestamp
    }
  ]
}

**Use Cases:**
- Improve transcription of specific terms
- Define pronunciations for names
- Add technical vocabulary
- Set up acronyms and abbreviations

**Examples:**
- All entries: {}
- Team entries only: { "scope": "team" }

**Error Handling:**
- Returns "Error: Authentication required" if API key/JWT is invalid`,
      inputSchema: DictionaryListSchema,
      annotations: {
        title: "List 60DB Dictionary Entries",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: DictionaryListParams) => {
      try {
        const apiClient = getApiClient();

        const queryParams: Record<string, unknown> = {};
        if (params.scope !== "all") queryParams.scope = params.scope;

        // GET /60db/dictionary returns { success, data: [...] } — no pagination.
        const response = await apiClient.get<{ data: unknown[] }>("/60db/dictionary", queryParams);
        const entries = response.data || [];

        const lines: string[] = [];
        lines.push(`# 60DB Dictionary (${entries.length} entries)`);
        lines.push("");

        if (params.response_format === ResponseFormat.JSON) {
          const formatted = JSON.stringify({ total: entries.length, entries }, null, 2);
          const { content } = truncateIfNeeded(formatted, true);

          return {
            content: [{ type: "text", text: content }]
          };
        }

        // Markdown format
        for (const entry of entries as any) {
          lines.push(formatDictionaryEntry(entry, params.response_format));
        }

        const { content } = truncateIfNeeded(lines.join("\n"), false);

        return {
          content: [{ type: "text", text: content }]
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

  // Add dictionary entry
  server.registerTool(
    "sixtydb_60db_add_dictionary",
    {
      title: "Add 60DB Dictionary Entry",
      description: `Add a new pronunciation dictionary entry.

Dictionary entries define how specific terms should be transcribed, improving accuracy for names, technical terms, and industry-specific vocabulary.

**Parameters:**
- term (string, required): The term/phrase to replace (max 200 characters)
- replacement (string, required): The replacement text (max 200 characters)
- tag (string, optional): Optional label for the entry (e.g. "abbreviation")
- scope ('personal' | 'team', optional): Entry scope (default: 'personal')
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For JSON format:
{
  "id": string,              // Entry ID (hash_id)
  "term": string,            // Original term
  "replacement": string,     // Replacement text
  "tag": string | null,
  "scope": string,           // Entry scope
  "createdBy": number
}

**Examples:**
- Personal entry: { "term": "QLabs", "replacement": "Cue Labs" }
- Team entry: { "term": "CEO", "replacement": "Chief Executive Officer", "scope": "team" }

**Best Practices:**
- Use for names: "Nguyen" → "Win"
- Technical terms: "API" → "A P I"
- Acronyms: "YOLO" → "you only live once"

**Error Handling:**
- Returns "Error: term and replacement are required" if either is missing`,
      inputSchema: DictionaryAddSchema,
      annotations: {
        title: "Add 60DB Dictionary Entry",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: DictionaryAddParams) => {
      try {
        const apiClient = getApiClient();

        const requestBody = {
          term: params.term,
          replacement: params.replacement,
          scope: params.scope,
          ...(params.tag && { tag: params.tag })
        };

        // POST /60db/dictionary returns { success, message, data: {...} }.
        const response = await apiClient.post<{ data: unknown }>("/60db/dictionary", requestBody);

        const formatted = formatDictionaryEntry(response.data as any, params.response_format);

        const { content } = truncateIfNeeded(
          formatted,
          params.response_format === ResponseFormat.JSON
        );

        return {
          content: [{ type: "text", text: content }]
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

  // List snippets
  server.registerTool(
    "sixtydb_60db_list_snippets",
    {
      title: "List 60DB Snippets",
      description: `List text snippets.

Snippets are reusable text templates that can be quickly inserted into transcriptions, notes, or other text content. \`scope=all\` (default) returns your personal snippets plus your workspace's team snippets (no pagination or search on this endpoint).

**Parameters:**
- scope ('personal' | 'team' | 'all', optional): Filter by scope (default: 'all')
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For JSON format:
{
  "total": number,
  "snippets": [             // Array of snippet objects
    {
      "id": string,
      "title": string,
      "content": string,
      "tag": string | null,
      "scope": "personal" | "team",
      "createdBy": number,
      "createdAt": string
    }
  ]
}

**Use Cases:**
- Quick access to common text templates
- Standardized responses or descriptions
- Reusable content blocks

**Examples:**
- All snippets: {}
- Team snippets only: { "scope": "team" }

**Error Handling:**
- Returns "Error: Authentication required" if API key/JWT is invalid`,
      inputSchema: SnippetsListSchema,
      annotations: {
        title: "List 60DB Snippets",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: SnippetsListParams) => {
      try {
        const apiClient = getApiClient();

        const queryParams: Record<string, unknown> = {};
        if (params.scope !== "all") queryParams.scope = params.scope;

        // GET /60db/snippets returns { success, data: [...] } — no pagination.
        const response = await apiClient.get<{ data: unknown[] }>("/60db/snippets", queryParams);
        const snippets = response.data || [];

        const lines: string[] = [];
        lines.push(`# 60DB Snippets (${snippets.length} total)`);
        lines.push("");

        if (params.response_format === ResponseFormat.JSON) {
          const formatted = JSON.stringify({ total: snippets.length, snippets }, null, 2);
          const { content } = truncateIfNeeded(formatted, true);

          return {
            content: [{ type: "text", text: content }]
          };
        }

        // Markdown format
        for (const snippet of snippets as any) {
          lines.push(formatSnippet(snippet, params.response_format));
        }

        const { content } = truncateIfNeeded(lines.join("\n"), false);

        return {
          content: [{ type: "text", text: content }]
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

  // Add snippet
  server.registerTool(
    "sixtydb_60db_add_snippet",
    {
      title: "Add 60DB Snippet",
      description: `Add a new text snippet.

Snippets are reusable text templates for quick insertion into transcriptions, notes, or other content.

**Parameters:**
- title (string, required): Snippet title (max 100 characters)
- content (string, required): Snippet content (max 10000 characters)
- tag (string, optional): Snippet tag/category (max 50 characters)
- scope ('personal' | 'team', optional): Snippet scope (default: 'personal')
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
Created snippet details with ID and metadata.

**Examples:**
- Basic snippet: { "title": "Meeting Opening", "content": "Thank you all for joining..." }
- With tag: { "title": "Sign-off", "content": "Best regards,", "tag": "closings" }

**Use Cases:**
- Standard meeting openings/closings
- Common email responses
- Reusable descriptions or templates

**Error Handling:**
- Returns "Error: title and content are required" if either is missing`,
      inputSchema: SnippetAddSchema,
      annotations: {
        title: "Add 60DB Snippet",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: SnippetAddParams) => {
      try {
        const apiClient = getApiClient();

        const requestBody = {
          title: params.title,
          content: params.content,
          scope: params.scope,
          ...(params.tag && { tag: params.tag })
        };

        // POST /60db/snippets returns { success, message, data: {...} }.
        const response = await apiClient.post<{ data: unknown }>("/60db/snippets", requestBody);

        const formatted = formatSnippet(response.data as any, params.response_format);

        const { content } = truncateIfNeeded(
          formatted,
          params.response_format === ResponseFormat.JSON
        );

        return {
          content: [{ type: "text", text: content }]
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

  // List notes
  server.registerTool(
    "sixtydb_60db_list_notes",
    {
      title: "List 60DB Notes",
      description: `List personal notes with pagination.

Notes are for storing personal thoughts, summaries, or any text content with an optional single tag for organization. There is no tag-filter or search on this endpoint — only pagination.

**Parameters:**
- limit (number, optional): Maximum results to return (1-100, default: 20)
- offset (number, optional): Number of results to skip for pagination (default: 0)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For JSON format:
{
  "total": number,
  "notes": [                // Array of note objects
    {
      "id": string,
      "title": string,
      "content": string,
      "tag": string | null,
      "timestamp": number,
      "createdAt": string,
      "updatedAt": string
    }
  ],
  "has_more": boolean,
  "next_offset": number
}

**Use Cases:**
- Store meeting notes and summaries
- Keep research notes and findings

**Examples:**
- Recent notes: {}
- Next page: { "offset": 20 }

**Error Handling:**
- Returns "Error: Authentication required" if API key/JWT is invalid`,
      inputSchema: NotesListSchema,
      annotations: {
        title: "List 60DB Notes",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: NotesListParams) => {
      try {
        const apiClient = getApiClient();

        const queryParams: Record<string, unknown> = {
          limit: params.limit,
          offset: params.offset
        };

        // GET /60db/notes returns { success, data: [...], total } (no `notes` key).
        const data = await apiClient.get<{
          data: unknown[];
          total: number;
        }>("/60db/notes", queryParams);

        const notes = data.data || [];
        const total = data.total ?? notes.length;
        const hasMore = params.offset + notes.length < total;

        const lines: string[] = [];
        lines.push(`# 60DB Notes (${total} total)`);
        lines.push("");

        if (params.response_format === ResponseFormat.JSON) {
          const response = {
            total,
            count: notes.length,
            offset: params.offset,
            notes,
            has_more: hasMore,
            next_offset: hasMore ? params.offset + notes.length : undefined
          };

          const formatted = JSON.stringify(response, null, 2);
          const { content } = truncateIfNeeded(formatted, true);

          return {
            content: [{ type: "text", text: content }]
          };
        }

        // Markdown format
        for (const note of notes as any) {
          lines.push(formatNote(note, params.response_format));
        }

        if (hasMore) {
          lines.push(`\n---\n**More results available.** Use offset=${params.offset + notes.length} to see more.`);
        }

        const { content } = truncateIfNeeded(lines.join("\n"), false);

        return {
          content: [{ type: "text", text: content }]
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

  // Add note
  server.registerTool(
    "sixtydb_60db_add_note",
    {
      title: "Add 60DB Note",
      description: `Add a new personal note.

Notes are for storing personal thoughts, summaries, or any text content with an optional single tag for organization.

**Parameters:**
- title (string, required): Note title (max 200 characters)
- content (string, required): Note content (max 50000 characters)
- tag (string, optional): Single tag for the note (max 50 characters)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
Created note details with ID, tag, and metadata.

**Examples:**
- Basic note: { "title": "Meeting Notes", "content": "Discussed Q1 roadmap..." }
- With a tag: { "title": "Research", "content": "Findings from user testing...", "tag": "ux" }

**Use Cases:**
- Meeting summaries and action items
- Research notes and findings
- Personal reminders and thoughts`,
      inputSchema: NoteAddSchema,
      annotations: {
        title: "Add 60DB Note",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: NoteAddParams) => {
      try {
        const apiClient = getApiClient();

        const requestBody = {
          title: params.title,
          content: params.content,
          ...(params.tag && { tag: params.tag })
        };

        // POST /60db/notes returns { success, message, data: {...} }.
        const response = await apiClient.post<{ data: unknown }>("/60db/notes", requestBody);

        const formatted = formatNote(response.data as any, params.response_format);

        const { content } = truncateIfNeeded(
          formatted,
          params.response_format === ResponseFormat.JSON
        );

        return {
          content: [{ type: "text", text: content }]
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

  // Get note details
  server.registerTool(
    "sixtydb_60db_get_note",
    {
      title: "Get 60DB Note Details",
      description: `Get detailed information about a specific note.

There is no dedicated "get one note" endpoint on the 60db API. This tool paginates through GET /60db/notes (up to 200 most recent notes) and returns the entry matching the given id — note content is already returned in full by the list endpoint, so this is mainly a convenience lookup.

**Parameters:**
- id (string, required): Note ID (hash_id, as returned by sixtydb_60db_list_notes)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
Complete note details with full content, tag, and metadata.

**Examples:**
- Get note: { "id": "note_abc123" }

**Error Handling:**
- Returns "Error: Note not found" if the id isn't among the 200 most recent notes`,
      inputSchema: NoteGetSchema,
      annotations: {
        title: "Get 60DB Note Details",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: NoteGetParams) => {
      try {
        const apiClient = getApiClient();

        // No GET /60db/notes/:id route — search the most recent notes instead.
        const response = await apiClient.get<{ data: any[] }>("/60db/notes", { limit: 200, offset: 0 });
        const notes = response.data || [];
        const note = notes.find((n) => n.id === params.id);

        if (!note) {
          return {
            content: [{
              type: "text",
              text: `**Error**: Note not found. "${params.id}" was not among the 200 most recent notes (use sixtydb_60db_list_notes with offset to page further back).`
            }]
          };
        }

        const formatted = formatNote(note, params.response_format);

        const { content } = truncateIfNeeded(
          formatted,
          params.response_format === ResponseFormat.JSON
        );

        return {
          content: [{ type: "text", text: content }]
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
