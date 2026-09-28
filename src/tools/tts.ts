/**
 * Text-to-Speech (TTS) Tools
 * Tools for TTS synthesis and history
 *
 * Backend routes actually used (routes/index.js, mounted at "/" and "/tts"):
 *  - POST /tts-synthesize -> ttsController.synthesizeTTS
 *      Body: { text, voice_id, speed, stability, similarity, audio_encoding,
 *              audio_config: { audio_encoding, sample_rate_hertz }, stream }
 *      Response (non-stream, the default): raw binary audio bytes, NOT JSON.
 *      Content-Type reflects the encoding (defaults to audio/wav for LINEAR16).
 *      No audio is persisted server-side — there is no audio_url to fetch
 *      later, so this tool returns the audio inline as an MCP audio content
 *      block (base64), not a URL.
 *  - GET  /tts/logs -> ttsController.getTTSLogs
 *      Query: page (NOT offset), limit, voice_id, date_from, date_to (NOT
 *      from_date/to_date). Response: top-level `{ logs, pagination }`, not
 *      `{ data: { logs, total } }`.
 *  - GET  /tts/:id  -> ttsController.getTTSDetail. Response: `{ data: row }`.
 *
 * The old implementation called /tts-synthesize but parsed the response as
 * concatenated JSON chunks `{"result":{"audioContent": "..."}}}` — that
 * shape does not exist on this endpoint (it was likely confused with the
 * unrelated /tts-stream NDJSON endpoint). The real response is a single
 * binary blob, which is what this file now handles.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  TTSSynthesizeSchema,
  TTSLogsSchema,
  TTSGetSchema
} from "../schemas/index.js";
import {
  TTSSynthesizeParams,
  TTSLogsParams,
  TTSGetParams
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import {
  formatTTSLog,
  formatTTSLogList,
  truncateIfNeeded,
  formatErrorMessage
} from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";
import { saveTemporaryAudio } from "../services/temporary-audio-store.js";

// Inline base64 audio above this many raw bytes is impractical for a tool
// response — ask the caller to shorten the text instead of silently
// truncating audio (which would produce a corrupt, unplayable file).
const MAX_INLINE_AUDIO_BYTES = 8 * 1024 * 1024;

const AUDIO_ENCODING_BY_FORMAT: Record<string, string> = {
  wav: "LINEAR16",
  mp3: "MP3",
  ogg: "OGG_OPUS"
};

const MIME_BY_AUDIO_ENCODING: Record<string, string> = {
  LINEAR16: "audio/wav",
  MP3: "audio/mpeg",
  OGG_OPUS: "audio/ogg"
};

/**
 * Register TTS tools
 */
export function registerTTSTools(server: McpServer): void {
  // Synthesize speech
  server.registerTool(
    "sixtydb_tts_synthesize",
    {
      title: "Synthesize Text-to-Speech",
      description: `Convert text to speech using the specified voice (\`POST /tts-synthesize\`).

Returns a **playable audio link** (valid 24 hours) on the hosted server — always show this link to the user. (Local stdio mode returns the audio inline instead.) **Note: This operation deducts from the workspace wallet based on text length.**

**Parameters:**
- text (string, required): Text to convert to speech (max 5000 characters)
- voice_id (string, required): ID of the voice to use — get this from sixtydb_list_voices
- speed (number, optional): Speech speed multiplier (0.25-2.0, default: 1)
- stability (number, optional): Voice stability 0-100 (default: 50)
- similarity (number, optional): Voice similarity 0-100 (default: 75)
- output_format (string, optional): 'wav' (default, confirmed supported), 'mp3' or 'ogg' (best-effort)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:** a summary (voice, duration estimate, cost) plus an inline audio attachment. If the generated audio is too large to inline (>8MB), returns an error asking you to shorten the text — there is no alternate way to retrieve it since it isn't stored server-side.

**Error Handling:**
- Returns "Error: ... Insufficient credits" (402) if the wallet balance is too low
- Returns "Error: Text too long" if text exceeds 5000 characters
- Returns "Error: Rate limit exceeded" if too many requests (429 status)`,
      inputSchema: TTSSynthesizeSchema,
      annotations: {
        title: "Synthesize Text-to-Speech",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: TTSSynthesizeParams) => {
      try {
        const audioEncoding = AUDIO_ENCODING_BY_FORMAT[params.output_format ?? "wav"] ?? "LINEAR16";

        const requestBody = {
          text: params.text,
          voice_id: params.voice_id,
          speed: params.speed ?? 1,
          stability: params.stability ?? 50,
          similarity: params.similarity ?? 75,
          stream: false,
          audio_encoding: audioEncoding,
          audio_config: { audio_encoding: audioEncoding }
        };

        const axiosInstance = getApiClient().getAxiosInstance();
        const response = await axiosInstance.post("/tts-synthesize", requestBody, {
          responseType: "arraybuffer",
          timeout: 120_000
        });

        const contentType = String(response.headers["content-type"] || "");
        const buffer = Buffer.from(response.data as ArrayBuffer);

        // The backend only sends JSON on failure paths; with arraybuffer as
        // the response type those bytes land here undecoded — detect and
        // surface the real message instead of treating it as audio.
        if (contentType.includes("application/json")) {
          let message = "TTS synthesis failed";
          try {
            const parsed = JSON.parse(buffer.toString("utf8"));
            message = parsed?.message || message;
          } catch {
            // fall through with generic message
          }
          throw new Error(message);
        }

        if (buffer.length === 0) {
          throw new Error("TTS API returned an empty audio response");
        }

        if (buffer.length > MAX_INLINE_AUDIO_BYTES) {
          return {
            content: [{
              type: "text" as const,
              text: `**Error**: Generated audio is ${(buffer.length / 1024 / 1024).toFixed(1)}MB, too large to return inline. This API does not persist synthesis audio server-side, so there is no URL fallback — shorten the text and try again.`
            }]
          };
        }

        const mimeType = MIME_BY_AUDIO_ENCODING[audioEncoding] || contentType.split(";")[0] || "audio/wav";
        // Hosted mode: a playable 24h link (chat clients can't play inline audio).
        const audioUrl = saveTemporaryAudio(buffer, mimeType);
        if (audioUrl) {
          const details = {
            audio_url: audioUrl,
            expires_in_hours: 24,
            voice_id: params.voice_id,
            speed: requestBody.speed,
            mime_type: mimeType,
            audio_bytes: buffer.length
          };
          return {
            content: [{
              type: "text" as const,
              text: params.response_format === ResponseFormat.JSON
                ? JSON.stringify(details, null, 2)
                : `## TTS Synthesis Complete\n\n**Listen / download:** ${audioUrl}\n(link valid for 24 hours)\n\n**Text:** ${params.text}\n**Voice ID:** ${params.voice_id}\n**Speed:** ${requestBody.speed}\n**Audio:** ${mimeType}, ${(buffer.length / 1024).toFixed(1)} KB\n\nShare the link above with the user so they can play it. It can also be passed to sixtydb_stt_transcribe.`
            }]
          };
        }

        // stdio mode: return the audio inline.
        const base64Audio = buffer.toString("base64");

        const summary = params.response_format === ResponseFormat.JSON
          ? JSON.stringify({
              text: params.text,
              voice_id: params.voice_id,
              speed: requestBody.speed,
              stability: requestBody.stability,
              similarity: requestBody.similarity,
              mime_type: mimeType,
              audio_bytes: buffer.length
            }, null, 2)
          : `## TTS Synthesis Complete\n\n**Text:** ${params.text}\n**Voice ID:** ${params.voice_id}\n**Speed:** ${requestBody.speed}\n**Stability:** ${requestBody.stability}\n**Similarity:** ${requestBody.similarity}\n**Audio:** ${mimeType}, ${(buffer.length / 1024).toFixed(1)} KB (attached below)`;

        return {
          content: [
            { type: "text" as const, text: summary },
            { type: "audio" as const, data: base64Audio, mimeType }
          ]
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

  // Get TTS history/logs
  server.registerTool(
    "sixtydb_tts_logs",
    {
      title: "Get TTS History",
      description: `Retrieve TTS generation history (\`GET /tts/logs\`) — metadata only (text, voice, duration, cost); audio itself is not persisted, so \`audio_url\` will typically be empty.

**Parameters:**
- voice_id (string, optional): Filter by specific voice ID
- from_date (string, optional): Filter by start date (ISO 8601 format, e.g., '2024-01-01T00:00:00Z')
- to_date (string, optional): Filter by end date (ISO 8601 format)
- limit (number, optional): Maximum results to return (1-100, default: 20)
- offset (number, optional): Number of results to skip for pagination (default: 0)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Error Handling:**
- Returns "Error: Authentication required" if the API key is invalid`,
      inputSchema: TTSLogsSchema,
      annotations: {
        title: "Get TTS History",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: TTSLogsParams) => {
      try {
        const apiClient = getApiClient();

        // Backend paginates by `page`, not `offset` — translate.
        const page = Math.floor(params.offset / params.limit) + 1;
        const queryParams: Record<string, unknown> = {
          page,
          limit: params.limit
        };

        if (params.voice_id) queryParams.voice_id = params.voice_id;
        if (params.from_date) queryParams.date_from = params.from_date;
        if (params.to_date) queryParams.date_to = params.to_date;

        const data = await apiClient.get<{
          logs: unknown[];
          pagination: { page: number; limit: number; total: number; pages: number };
        }>("/tts/logs", queryParams);

        const logs = data.logs || [];
        const total = data.pagination?.total ?? logs.length;
        const hasMore = params.offset + logs.length < total;

        const formatted = formatTTSLogList(
          logs as any,
          total,
          params.offset,
          hasMore,
          params.response_format
        );

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

  // Get TTS details
  server.registerTool(
    "sixtydb_tts_get",
    {
      title: "Get TTS Generation Details",
      description: `Get detailed information about a specific TTS generation (\`GET /tts/{id}\`). \`audio_url\` will typically be empty — synthesis audio isn't persisted server-side.

**Parameters:**
- id (string, required): TTS generation ID (the \`hash_id\` from sixtydb_tts_logs)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Error Handling:**
- Returns "Error: Generation not found" if ID doesn't exist (404 status)
- Returns "Error: Authentication required" if the API key is invalid`,
      inputSchema: TTSGetSchema,
      annotations: {
        title: "Get TTS Generation Details",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: TTSGetParams) => {
      try {
        const apiClient = getApiClient();

        const body = await apiClient.get<{ success: boolean; data?: unknown }>(`/tts/${encodeURIComponent(params.id)}`);

        const formatted = formatTTSLog(body.data, params.response_format);

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
}
