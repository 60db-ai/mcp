/**
 * Meeting and Analytics Tools
 * Tools for meeting management and usage analytics
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  MeetingsListSchema,
  MeetingGetSchema,
  MeetingCreateSchema,
  UsageStatsSchema
} from "../schemas/index.js";
import {
  MeetingsListParams,
  MeetingGetParams,
  MeetingCreateParams,
  UsageStatsParams
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import {
  formatMeeting,
  formatMeetingList,
  formatUsageStats,
  truncateIfNeeded,
  formatErrorMessage
} from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

/**
 * Register meeting and analytics tools
 */
export function registerMeetingAndAnalyticsTools(server: McpServer): void {
  // List meetings
  server.registerTool(
    "sixtydb_list_meetings",
    {
      title: "List 60DB Meetings",
      description: `List meetings with filtering and pagination.

This tool retrieves meetings recorded through the 60DB platform (page-based pagination, not offset-based). There is no title search or date-range filter on this endpoint.

**Parameters:**
- status ('recording' | 'processing' | 'completed', optional): Filter by meeting status
- page (number, optional): Page number, 1-based (default: 1)
- limit (number, optional): Results per page, max 100 (default: 20)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For JSON format:
{
  "total": number,
  "page": number,
  "meetings": [             // Array of meeting summaries
    {
      "id": string,
      "title": string,
      "platform": string,
      "start_time": string,
      "end_time": string | null,
      "duration_minutes": number | null,
      "status": string,      // recording|processing|completed
      "trigger_type": string,
      "has_audio": boolean,
      "has_notes": boolean
    }
  ],
  "has_more": boolean,
  "next_page": number
}

**Meeting Statuses:**
- **recording**: Currently being recorded
- **processing**: Transcription is in progress
- **completed**: Meeting is fully processed

**Use Cases:**
- Browse meeting history
- Check processing status
- Find meeting IDs to fetch full transcripts/notes

**Examples:**
- Recent completed meetings: { "status": "completed", "limit": 10 }
- Next page: { "page": 2 }

**Error Handling:**
- Returns "Error: Authentication required" if API key/JWT is invalid`,
      inputSchema: MeetingsListSchema,
      annotations: {
        title: "List 60DB Meetings",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: MeetingsListParams) => {
      try {
        const apiClient = getApiClient();

        const queryParams: Record<string, unknown> = {
          page: params.page,
          limit: params.limit
        };
        if (params.status) queryParams.status = params.status;

        // GET /60db/meetings returns { success, data: { meetings, total, page, limit } }.
        const response = await apiClient.get<{
          data: { meetings: unknown[]; total: number; page: number; limit: number };
        }>("/60db/meetings", queryParams);

        const data = response.data || { meetings: [], total: 0, page: params.page, limit: params.limit };
        const meetings = data.meetings || [];
        const total = data.total ?? meetings.length;
        const hasMore = data.page * data.limit < total;

        const formatted = formatMeetingList(
          meetings as any,
          total,
          data.page ?? params.page,
          hasMore,
          params.response_format
        );

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

  // Get meeting details
  server.registerTool(
    "sixtydb_get_meeting",
    {
      title: "Get Meeting Details",
      description: `Get detailed information about a specific meeting.

This tool retrieves complete details for a single meeting including the full transcript chunks, AI-generated notes, and audio URL.

**Parameters:**
- id (string, required): Meeting ID
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For JSON format:
{
  "id": string,
  "title": string,
  "platform": string,
  "start_time": string,
  "end_time": string | null,
  "duration_minutes": number | null,
  "status": string,
  "trigger_type": string,
  "audio_url": string | null,
  "transcript": [{ "id": string, "text": string, "is_final": boolean, "confidence": number, "timestamp": string }],
  "notes": { "id": string, "summary": string, "key_points": string[], "action_items": object[], "decisions": string[], "generated_at": string } | null
}

**Use Cases:**
- Review meeting transcripts
- Access AI-generated summaries
- Get meeting audio
- Check processing status

**Examples:**
- Get meeting details: { "id": "meeting_abc123" }

**AI Features:**
- **notes.summary / notes.key_points / notes.action_items / notes.decisions**: generated after the meeting is stopped (null while still recording)
- **transcript**: array of timestamped chunks, not a single string

**Error Handling:**
- Returns "Error: Meeting not found" if ID doesn't exist (404 status)`,
      inputSchema: MeetingGetSchema,
      annotations: {
        title: "Get Meeting Details",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: MeetingGetParams) => {
      try {
        const apiClient = getApiClient();

        // GET /60db/meetings/:id returns { success, data: {...} }.
        const response = await apiClient.get<{ data: unknown }>(`/60db/meetings/${params.id}`);

        const formatted = formatMeeting(response.data as any, params.response_format);

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

  // Create meeting
  server.registerTool(
    "sixtydb_create_meeting",
    {
      title: "Create 60DB Meeting",
      description: `Create a new meeting recording session (status starts as "recording").

**Important:** this only creates the meeting row. Finishing it (uploading the transcript/audio via \`PUT /60db/meetings/:id/stop\`, a multipart endpoint) is not exposed as an MCP tool, so a meeting created here will stay in "recording" status until it is stopped from the 60db app or desktop client.

**Parameters:**
- title (string, required): Meeting title (max 200 characters)
- platform ('zoom' | 'google-meet' | 'teams' | 'webex' | 'slack' | 'manual', optional, default 'manual')
- start_time (string, optional, ISO 8601): Defaults to now
- trigger_type ('manual' | 'auto', optional, default 'manual')
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For JSON format:
{
  "id": string,              // New meeting ID
  "title": string,
  "platform": string,
  "start_time": string,
  "status": "recording",     // Initial status
  "trigger_type": string
}

**Examples:**
- Create meeting: { "title": "Weekly Standup" }

**Use Cases:**
- Pre-create a meeting record before recording it in the 60db app

**Error Handling:**
- Returns "Error: title, platform, start_time, and trigger_type are required" if any are missing
- Returns "Error: Authentication required" if API key/JWT is invalid`,
      inputSchema: MeetingCreateSchema,
      annotations: {
        title: "Create 60DB Meeting",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: MeetingCreateParams) => {
      try {
        const apiClient = getApiClient();

        const requestBody = {
          title: params.title,
          platform: params.platform,
          start_time: params.start_time || new Date().toISOString(),
          trigger_type: params.trigger_type
        };

        // POST /60db/meetings returns { success, message, data: {...} }.
        const response = await apiClient.post<{ data: unknown }>("/60db/meetings", requestBody);

        const formatted = formatMeeting(response.data as any, params.response_format);

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

  // Get usage statistics
  server.registerTool(
    "sixtydb_get_usage_stats",
    {
      title: "Get Usage Statistics",
      description: `Retrieve current usage statistics and credit balance.

This tool provides comprehensive usage statistics across all QLabs services including TTS, STT, and LLM API usage.

**Parameters:**
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For Markdown format (default):
- Detailed credit usage breakdown
- Remaining balance
- Current billing period

For JSON format:
{
  "tts_credits_used": number,     // Credits used for TTS
  "stt_credits_used": number,     // Credits used for STT
  "llm_credits_used": number,     // Credits used for LLM
  "total_credits_used": number,   // Total credits used
  "credits_remaining": number,    // Remaining balance
  "period": {
    "start": string,              // Billing period start
    "end": string                 // Billing period end
  }
}

**Use Cases:**
- Monitor credit consumption
- Check remaining balance
- Plan usage for billing period
- Track which services are used most

**Examples:**
- Get usage stats: {}

**Credit Tracking:**
- Credits reset at billing period start
- Different services consume credits at different rates
- Usage updates in near real-time

**Error Handling:**
- Returns "Error: Authentication required" if API key/JWT is invalid`,
      inputSchema: UsageStatsSchema,
      annotations: {
        title: "Get Usage Statistics",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: UsageStatsParams) => {
      try {
        const apiClient = getApiClient();

        const stats = await apiClient.get<unknown>("/analytics/usage");

        const formatted = formatUsageStats(stats as any, params.response_format);

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
