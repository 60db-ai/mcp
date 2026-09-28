/**
 * Speech-to-Text (STT) Tools
 * Tools for STT transcription and history
 *
 * Backend routes actually used (routes/index.js, mounted at "/" and "/tts"):
 *  - POST /stt      -> sttController.transcribeAudio
 *      Requires multipart/form-data with a `file` field (req.files.file) —
 *      there is NO `audio_url` JSON field on this endpoint. Hosted MCP has
 *      no local filesystem, so this tool downloads `audio_url` server-side
 *      and re-uploads the bytes as multipart. Optional form fields:
 *      language, diarize, context, keywords, languages, return_timestamps,
 *      min_speakers/max_speakers.
 *      Response: the raw upstream STT JSON (text, language, segments, ...)
 *      merged with { has_audio, hash_id } — no `{success,data}` wrapper.
 *  - GET  /stt/logs -> sttController.getSTTLogs
 *      Query: page (NOT offset), limit, language, date_from, date_to (NOT
 *      from_date/to_date). Response: top-level `{ logs, pagination }`.
 *  - GET  /stt/:id  -> sttController.getSTTDetail. Response: `{ data: row }`
 *      (a `stt_item` row — field is `transcript`, not `text`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import axios from "axios";
import FormData from "form-data";
import dns from "dns/promises";
import net from "net";
import {
  STTTranscribeSchema,
  STTLogsSchema,
  STTGetSchema
} from "../schemas/index.js";
import {
  STTTranscribeParams,
  STTLogsParams,
  STTGetParams
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import {
  formatSTTLog,
  formatSTTLogList,
  truncateIfNeeded,
  formatErrorMessage
} from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

const STT_EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "video/mp4": "mp4"
};

// Kept modest (well under the backend's 100MB cap) so a hosted download +
// re-upload round trip stays within a reasonable tool-call latency budget.
const STT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4]
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + (parseInt(octet, 10) & 0xff), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    if (net.isIPv4(mapped)) return isPrivateIPv4(mapped);
  }
  return false;
}

/**
 * Basic SSRF guard for user-supplied audio URLs: require https, reject
 * literal loopback/private/link-local hosts, and resolve the hostname to
 * reject DNS names that point at internal infrastructure. Best-effort — it
 * does not pin the resolved IP for the subsequent request, so a
 * TOCTOU/DNS-rebinding attacker could still slip through; flagged as a
 * known residual risk (see report).
 */
async function assertPublicHttpsUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("audio_url must use https://");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("audio_url may not point to a local/internal host");
  }
  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) && isPrivateIPv4(hostname)) throw new Error("audio_url may not point to a private/internal IP");
    if (net.isIPv6(hostname) && isPrivateIPv6(hostname)) throw new Error("audio_url may not point to a private/internal IP");
    return;
  }
  const { address } = await dns.lookup(hostname);
  if (net.isIPv4(address) && isPrivateIPv4(address)) throw new Error("audio_url resolves to a private/internal IP");
  if (net.isIPv6(address) && isPrivateIPv6(address)) throw new Error("audio_url resolves to a private/internal IP");
}

/** Download the audio at `url` for re-upload as multipart/form-data. */
async function downloadAudioFile(url: string): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  await assertPublicHttpsUrl(url);
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxRedirects: 3,
    maxContentLength: STT_MAX_DOWNLOAD_BYTES,
    maxBodyLength: STT_MAX_DOWNLOAD_BYTES
  });
  const contentType = String(response.headers["content-type"] || "audio/mpeg").split(";")[0].trim();
  const ext = STT_EXT_BY_MIME[contentType] || "mp3";
  return {
    buffer: Buffer.from(response.data),
    filename: `audio.${ext}`,
    contentType
  };
}

/**
 * Register STT tools
 */
export function registerSTTTools(server: McpServer): void {
  // Transcribe audio
  server.registerTool(
    "sixtydb_stt_transcribe",
    {
      title: "Transcribe Audio",
      description: `Transcribe an audio file to text via \`POST /stt\`. Powered by 60db STT v01 — a non-hallucinating multi-backend speech recognition stack. **Note: This operation requires credits based on audio duration.**

The backend only accepts a file upload (multipart/form-data) — there is no URL field on the API. This tool downloads \`audio_url\` server-side and re-uploads the bytes for you, so you can still just pass a public URL.

**Parameters:**
- audio_url (string, required): Public URL to audio file to transcribe (max 25MB — the backend itself allows up to 100MB, but this tool caps the download at 25MB to keep hosted latency reasonable; formats: WAV, MP3, M4A, OGG, FLAC, WebM, MP4 audio track)
- language (string, optional): ISO 639-1 code (e.g. \`en\`, \`hi\`, \`ar\`, \`fr\`). **Omit this field OR pass \`"auto"\`** to enable auto-detection across the 39 supported languages. Specifying a single supported language skips language identification entirely for lowest latency.
- diarize (boolean, optional): Enable pyannote speaker diarization. When \`true\`, each segment in the response includes a \`speakers\` array with \`SPEAKER_00\`, \`SPEAKER_01\`, … labels. Adds ~50–150 ms of processing latency.
- context (string, optional): Free-form paragraph describing the session (domain, speakers, jargon) that opens the server-side LLM refinement gate (requires a paid plan — ignored with a warning on the Free plan). When supplied, response text is polished for proper nouns, filler removal, and punctuation. Omit to skip refinement. Example: \`"Cricket coaching session. Players: Arjun Mehta, Ishaan Verma. Discussing batting technique."\`.
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Auto-detect:**
The most reliable way to auto-detect is to **omit the \`language\` field entirely**. Passing the literal string \`"auto"\` is also accepted and treated identically — it is stripped before forwarding to the backend.

**Response shape (JSON):**
\`\`\`
{
  "request_id": string,         // Unique request identifier
  "text": string,               // Full normalized transcript
  "language": string | null,    // Detected ISO 639-1 code ('en', 'hi', …); null on no-speech
  "language_name": string,      // Full English name (e.g. 'English')
  "language_source": string,    // 'fast_path' | 'language_id' | 'mixed'
  "duration_sec": number,       // Audio duration in seconds
  "processing_ms": number,      // Server processing time
  "rtf": number,                // Real-time factor
  "segments": [                 // Per-utterance segments
    {
      "start": number,
      "end": number,
      "language": string,
      "language_name": string,
      "text": string,
      "confidence": number,
      "words": [{ "word": string, "start": number, "end": number, "confidence": number }],
      "speakers": [{ "speaker": string, "start": number, "end": number }]  // when diarize=true
    }
  ],
  "words": array,               // Flat word list across all segments
  "warnings": array,            // Non-fatal warnings (e.g. no_speech_detected)
  "warning_codes": string[],    // Flat list of warning codes for quick checks
  "hash_id": string,            // ID to use with sixtydb_stt_get
  "has_audio": boolean          // Whether the source audio was archived server-side
}
\`\`\`

**Examples:**
- Auto-detect: \`{ "audio_url": "https://example.com/audio.mp3" }\`
- Specific language: \`{ "audio_url": "https://example.com/hindi.mp3", "language": "hi" }\`
- With speaker diarization: \`{ "audio_url": "https://example.com/meeting.mp3", "diarize": true }\`

**Supported Languages (39 total):**
- **European (25)**: English (\`en\`), Spanish (\`es\`), French (\`fr\`), German (\`de\`), Italian (\`it\`), Portuguese (\`pt\`), Dutch (\`nl\`), Polish (\`pl\`), Russian (\`ru\`), Ukrainian (\`uk\`), Czech (\`cs\`), Swedish (\`sv\`), Bulgarian (\`bg\`), Danish (\`da\`), Greek (\`el\`), Estonian (\`et\`), Finnish (\`fi\`), Croatian (\`hr\`), Hungarian (\`hu\`), Lithuanian (\`lt\`), Latvian (\`lv\`), Maltese (\`mt\`), Romanian (\`ro\`), Slovak (\`sk\`), Slovenian (\`sl\`)
- **Indic (13, with English code-switching)**: Hindi (\`hi\`), Bengali (\`bn\`), Marathi (\`mr\`), Punjabi (\`pa\`), Gujarati (\`gu\`), Odia (\`or\`), Assamese (\`as\`), Nepali (\`ne\`), Telugu (\`te\`), Kannada (\`kn\`), Tamil (\`ta\`), Malayalam (\`ml\`), Sanskrit (\`sa\`)
- **Arabic**: MSA (\`ar\`) — dialect tags like \`ar-eg\` are rejected

**Credit Cost:**
- Billed per second of audio (\`duration_sec\` field); diarization adds a 30% surcharge

**Error Handling:**
- Successful request with \`text: ""\` and \`warning_codes: ["no_speech_detected"]\` means the audio contained no speech (silence / music / noise). This is NOT an error — do not retry.
- Returns "Error: ... Insufficient credits" if balance is too low
- Returns "Error: audio exceeds the 25MB download cap" if the file at audio_url is too large
- Returns "Error: Invalid file type" for unsupported audio formats`,
      inputSchema: STTTranscribeSchema,
      annotations: {
        title: "Transcribe Audio",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: STTTranscribeParams) => {
      try {
        const audio = await downloadAudioFile(params.audio_url);

        const form = new FormData();
        form.append("file", audio.buffer, {
          filename: audio.filename,
          contentType: audio.contentType
        });

        const explicitLanguage =
          params.language && params.language.toLowerCase() !== "auto"
            ? params.language
            : undefined;
        if (explicitLanguage) form.append("language", explicitLanguage);

        if (params.diarize !== undefined) form.append("diarize", String(params.diarize));

        const contextStr = params.context && params.context.trim() ? params.context.trim() : undefined;
        if (contextStr) form.append("context", contextStr);

        const axiosInstance = getApiClient().getAxiosInstance();
        const response = await axiosInstance.post("/stt", form, {
          headers: form.getHeaders(),
          timeout: 600_000,
          maxContentLength: STT_MAX_DOWNLOAD_BYTES,
          maxBodyLength: STT_MAX_DOWNLOAD_BYTES
        });

        const formatted = formatSTTLog(response.data, params.response_format);

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

  // Get STT history/logs
  server.registerTool(
    "sixtydb_stt_logs",
    {
      title: "Get Transcription History",
      description: `Retrieve STT transcription history (\`GET /stt/logs\`) with filtering and pagination.

**Parameters:**
- language (string, optional): Filter by specific language code
- from_date (string, optional): Filter by start date (ISO 8601 format)
- to_date (string, optional): Filter by end date (ISO 8601 format)
- limit (number, optional): Maximum results to return (1-100, default: 20)
- offset (number, optional): Number of results to skip for pagination (default: 0)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Error Handling:**
- Returns "Error: Authentication required" if the API key is invalid`,
      inputSchema: STTLogsSchema,
      annotations: {
        title: "Get Transcription History",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: STTLogsParams) => {
      try {
        const apiClient = getApiClient();

        // Backend paginates by `page`, not `offset` — translate.
        const page = Math.floor(params.offset / params.limit) + 1;
        const queryParams: Record<string, unknown> = {
          page,
          limit: params.limit
        };

        if (params.language) queryParams.language = params.language;
        if (params.from_date) queryParams.date_from = params.from_date;
        if (params.to_date) queryParams.date_to = params.to_date;

        const data = await apiClient.get<{
          logs: unknown[];
          pagination: { page: number; limit: number; total: number; pages: number };
        }>("/stt/logs", queryParams);

        const logs = data.logs || [];
        const total = data.pagination?.total ?? logs.length;
        const hasMore = params.offset + logs.length < total;

        const formatted = formatSTTLogList(
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

  // Get STT details
  server.registerTool(
    "sixtydb_stt_get",
    {
      title: "Get Transcription Details",
      description: `Get detailed information about a specific transcription (\`GET /stt/{id}\`).

**Parameters:**
- id (string, required): STT transcription ID (the \`hash_id\` from sixtydb_stt_transcribe or sixtydb_stt_logs)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Error Handling:**
- Returns "Error: Transcription not found" if ID doesn't exist (404 status)
- Returns "Error: Authentication required" if the API key is invalid`,
      inputSchema: STTGetSchema,
      annotations: {
        title: "Get Transcription Details",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: STTGetParams) => {
      try {
        const apiClient = getApiClient();

        const body = await apiClient.get<{ success: boolean; data?: unknown }>(`/stt/${encodeURIComponent(params.id)}`);

        const formatted = formatSTTLog(body.data, params.response_format);

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
