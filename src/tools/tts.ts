/**
 * Text-to-Speech (TTS) Tools
 * Tools for TTS synthesis and history
 *
 * Backend routes actually used (routes/index.js, mounted at "/" and "/tts"):
 *  - POST /tts-synthesize -> ttsController.synthesizeTTS -> proxies
 *      ${TTS_API_URL}/tts/v1/voice verbatim (body AND response).
 *      Body: { text, voice_id, model_id, speed, stability, similarity,
 *              audio_config: { audio_encoding, sample_rate_hertz }, stream }
 *      `model_id` matters: the backend silently defaults to "indic_tts_v1"
 *      when omitted, and that model's response is JSON `{audioContent:
 *      <base64>}` — not raw bytes. The 60db app itself always sends
 *      "60db-quality-v01" explicitly (confirmed from its own request), which
 *      returns raw bytes for non-Indic voices. We mirror that default here
 *      and let a caller override it (e.g. an Indic-language voice may still
 *      need "indic_tts_v1"), but EITHER WAY the response is parsed
 *      defensively — see extractAudioBuffer — since which shape comes back
 *      depends on the model, not on anything this tool controls.
 *      Whichever shape it arrives in, the payload is headerless pcm_s16le
 *      (confirmed: no RIFF magic even when LINEAR16/wav was requested) —
 *      services/dubbing/ffmpeg-media-service.js's pcmToWav in the backend
 *      hits the exact same upstream and wraps it for the same reason. We
 *      mirror that wrapping (see pcmToWav below) so the link we hand back is
 *      an actually-playable .wav, not headerless samples mislabeled as one.
 *  - GET  /tts/logs -> ttsController.getTTSLogs
 *      Query: page (NOT offset), limit, voice_id, date_from, date_to (NOT
 *      from_date/to_date). Response: top-level `{ logs, pagination }`, not
 *      `{ data: { logs, total } }`.
 *  - GET  /tts/:id  -> ttsController.getTTSDetail. Response: `{ data: row }`.
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
// truncating audio (which would produce a corrupt, unplayable file). This
// only gates the stdio fallback (no audio store configured): hosted mode
// writes to disk and serves a link, so response size never comes into it.
const MAX_INLINE_AUDIO_BYTES = 8 * 1024 * 1024;
// Sanity cap for the hosted/disk-backed path, well above anything a 5,000-char
// request produces even at the slowest speed (uncompressed WAV ~48KB/sec, so
// ~400,000 characters' worth of silence-free speech) — just a backstop
// against pathological inputs filling disk, not a size chat clients hit.
const MAX_HOSTED_AUDIO_BYTES = 50 * 1024 * 1024;

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

// Matches the 60db app's own TTS requests (confirmed from a captured request);
// the backend's bare default ("indic_tts_v1") is a different model with a
// different response shape — see the file header.
const DEFAULT_MODEL_ID = "60db-quality-v01";
const SAMPLE_RATE_HERTZ = 24000;

/**
 * The upstream sometimes wraps audio as JSON (Inworld-style `audioContent`)
 * instead of sending raw bytes — which model_id is picked decides which, not
 * anything under this tool's control. Mirrors
 * services/dubbing/segment-synthesis-service.js's extractAudioBuffer in the
 * backend, which hits this exact same upstream.
 */
function extractAudioBuffer(contentType: string, raw: Buffer): Buffer {
  if (!/application\/json/i.test(contentType)) return raw;
  const json = JSON.parse(raw.toString("utf8"));
  const b64 = json.audioContent || json.audio_content || json.audio || json.result?.audioContent || json.result?.audio;
  if (!b64 || typeof b64 !== "string") {
    throw new Error(json.message || "TTS JSON response carried no audio content");
  }
  return Buffer.from(b64, "base64");
}

/** Known container magic bytes — anything else is treated as headerless raw PCM. */
function hasKnownAudioContainer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const m4 = buf.toString("latin1", 0, 4);
  if (m4 === "RIFF" || m4 === "OggS" || m4 === "fLaC" || m4 === "FORM") return true;
  if (m4.startsWith("ID3")) return true; // MP3 with ID3 tag
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true; // MPEG frame sync
  if (buf.toString("latin1", 4, 8) === "ftyp") return true; // MP4/M4A
  return false;
}

/** Wraps headerless pcm_s16le mono samples in a minimal WAV container — mirrors
 *  the backend's own services/dubbing/ffmpeg-media-service.js:pcmToWav, which
 *  exists for the identical reason (same upstream, same headerless response). */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

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
- output_format (string, optional): 'wav' (default, confirmed supported), 'mp3' or 'ogg' (best-effort — the upstream may ignore this and return raw samples anyway, which are then delivered as a .wav regardless of what was requested)
- model_id (string, optional): Synthesis model (default '60db-quality-v01', matching the 60db app). Only override for a voice known to need a different one.
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:** on the hosted server, a summary plus \`audio_url\` (playable/downloadable link, valid 24h) — **always show this link to the user**, regardless of audio length; there is no size limit on the link path. In local stdio mode (no hosted link storage configured) the audio is returned as an inline attachment instead, capped at 8MB — past that it returns an error asking you to shorten the text, since inline is the only option without a configured audio store.

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
          model_id: params.model_id ?? DEFAULT_MODEL_ID,
          speed: params.speed ?? 1,
          stability: params.stability ?? 50,
          similarity: params.similarity ?? 75,
          stream: false,
          audio_encoding: audioEncoding,
          audio_config: { audio_encoding: audioEncoding, sample_rate_hertz: SAMPLE_RATE_HERTZ }
        };

        const axiosInstance = getApiClient().getAxiosInstance();
        const response = await axiosInstance.post("/tts-synthesize", requestBody, {
          responseType: "arraybuffer",
          timeout: 120_000
        });

        const contentType = String(response.headers["content-type"] || "");
        const rawBody = Buffer.from(response.data as ArrayBuffer);

        // The upstream's response shape (raw bytes vs JSON-wrapped base64)
        // depends on which model answered, not on anything sent here — see
        // the file header. Try to pull audio out of either shape before
        // treating a JSON body as a hard failure.
        let buffer: Buffer;
        try {
          buffer = extractAudioBuffer(contentType, rawBody);
        } catch (extractError) {
          throw new Error((extractError as Error).message || "TTS synthesis failed");
        }

        if (buffer.length === 0) {
          throw new Error("TTS API returned an empty audio response");
        }

        // Confirmed against this upstream: audio comes back as headerless
        // pcm_s16le regardless of the requested encoding (LINEAR16/MP3/OGG
        // alike — the dubbing pipeline hits the same upstream and sees the
        // same thing). Without a known container, wrap it as WAV so the file
        // we hand back actually plays, instead of mislabeling raw samples as
        // whatever format was requested.
        const mimeType = hasKnownAudioContainer(buffer)
          ? (MIME_BY_AUDIO_ENCODING[audioEncoding] || contentType.split(";")[0] || "audio/wav")
          : "audio/wav";
        if (mimeType === "audio/wav" && !hasKnownAudioContainer(buffer)) {
          buffer = pcmToWav(buffer, SAMPLE_RATE_HERTZ);
        }

        // Hosted mode: a playable 24h link (chat clients can't play inline audio).
        // Tried FIRST and independent of size — unlike the inline base64 fallback
        // below, a disk-backed link doesn't inflate the tool response, so the
        // 8MB inline cap must never block it. Only a much larger pathological
        // file (MAX_HOSTED_AUDIO_BYTES) skips straight to the stdio-style error.
        if (buffer.length <= MAX_HOSTED_AUDIO_BYTES) {
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
        }

        // No audio store configured (stdio mode) — only option left is inline
        // base64, which a response of this size can't carry.
        if (buffer.length > MAX_INLINE_AUDIO_BYTES) {
          return {
            content: [{
              type: "text" as const,
              text: `**Error**: Generated audio is ${(buffer.length / 1024 / 1024).toFixed(1)}MB, too large to return inline, and this server isn't configured for hosted link delivery. Shorten the text and try again.`
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
