/**
 * Voice Management Tools
 * Tools for listing, retrieving, and creating voices
 *
 * Backend routes actually used (routes/index.js, mounted at "/" and "/tts"):
 *  - GET  /get-voices  -> voiceController.getVoices   (full catalog: built_in_voices + cloned_voices)
 *  - GET  /voices/:id  -> voiceController.getVoice
 *  - POST /voices      -> voiceController.createVoice (multipart: field `audio_file`, NOT a JSON body)
 *
 * NOTE: GET /voices (no id) maps to voiceController.getMyVoices, which is a
 * DIFFERENT, narrower endpoint (only cloned/professional voices, no catalog
 * built-ins) — using it here was the original bug: it could never surface a
 * built-in catalog voice like "Udit", and its response is `{ data: [...] }`
 * (a flat array under `data`), not `{ voices: [...] }` as the old code assumed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import axios from "axios";
import FormData from "form-data";
import dns from "dns/promises";
import net from "net";
import {
  VoiceListSchema,
  VoiceGetSchema,
  VoiceCreateSchema
} from "../schemas/index.js";
import {
  VoiceListParams,
  VoiceGetParams,
  VoiceCreateParams
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import {
  formatVoice,
  formatVoiceList,
  truncateIfNeeded,
  formatErrorMessage
} from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

const VOICE_SAMPLE_EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/flac": "flac",
  "audio/ogg": "ogg"
};

const VOICE_SAMPLE_MAX_BYTES = 25 * 1024 * 1024;
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
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    if (net.isIPv4(mapped)) return isPrivateIPv4(mapped);
  }
  return false;
}

/**
 * Basic SSRF guard for user-supplied audio URLs: require https, reject
 * literal loopback/private/link-local hosts, and resolve the hostname to
 * reject DNS names that point at internal infrastructure. Best-effort — see
 * the same helper in stt.ts for the residual-risk note (no IP pinning on
 * the follow-up request, so DNS-rebinding is not fully closed).
 */
async function assertPublicHttpsUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("sample_audio_url must use https://");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("sample_audio_url may not point to a local/internal host");
  }
  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) && isPrivateIPv4(hostname)) throw new Error("sample_audio_url may not point to a private/internal IP");
    if (net.isIPv6(hostname) && isPrivateIPv6(hostname)) throw new Error("sample_audio_url may not point to a private/internal IP");
    return;
  }
  const { address } = await dns.lookup(hostname);
  if (net.isIPv4(address) && isPrivateIPv4(address)) throw new Error("sample_audio_url resolves to a private/internal IP");
  if (net.isIPv6(address) && isPrivateIPv6(address)) throw new Error("sample_audio_url resolves to a private/internal IP");
}

/**
 * Download a remote audio sample so it can be re-uploaded as multipart
 * form-data (the 60db API only accepts file uploads for voice cloning, not
 * a `sample_audio_url` field). Hosted MCP has no local filesystem, so this
 * fetch-then-reupload dance is the only way to accept a URL from the caller.
 */
async function downloadAudioSample(url: string): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  await assertPublicHttpsUrl(url);
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxRedirects: 3,
    maxContentLength: VOICE_SAMPLE_MAX_BYTES,
    maxBodyLength: VOICE_SAMPLE_MAX_BYTES
  });
  const contentType = String(response.headers["content-type"] || "audio/mpeg").split(";")[0].trim();
  const ext = VOICE_SAMPLE_EXT_BY_MIME[contentType] || "mp3";
  return {
    buffer: Buffer.from(response.data),
    filename: `sample.${ext}`,
    contentType
  };
}

/**
 * Register voice management tools
 */
export function registerVoiceTools(server: McpServer): void {
  // List voices
  server.registerTool(
    "sixtydb_list_voices",
    {
      title: "List Voices",
      description: `List voices available for TTS: the shared built-in catalog plus your workspace's cloned/professional voices.

Calls \`GET /get-voices\`, which returns the FULL accessible catalog (not paginated server-side) — filtering, search, and pagination below are all applied client-side after fetching.

**Parameters:**
- is_clone (boolean, optional): true = only your cloned/professional voices, false = only the shared built-in catalog, omit = both
- search (string, optional): case-insensitive substring match on voice name — use this to find a specific voice by name (e.g. "Udit")
- limit (number, optional): Maximum results to return (1-100, default: 20)
- offset (number, optional): Number of results to skip for pagination (default: 0)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:** each voice's \`voice_id\` (pass this to sixtydb_tts_synthesize), \`name\`, \`category\`, \`model\`, and \`preview_url\` when available.

**Examples:**
- Find a voice by name: { "search": "Udit" }
- List only your own cloned voices: { "is_clone": true }

**Error Handling:**
- Returns "Error: Authentication required" if the API key is invalid
- Returns "Error: Rate limit exceeded" if too many requests (429 status)`,
      inputSchema: VoiceListSchema,
      annotations: {
        title: "List Voices",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: VoiceListParams) => {
      try {
        const apiClient = getApiClient();

        const body = await apiClient.get<{
          success: boolean;
          message?: string;
          data?: { built_in_voices?: unknown[]; cloned_voices?: unknown[] };
        }>("/get-voices");

        const builtIn = (body.data?.built_in_voices || []).map((v) => ({ ...(v as object), is_clone: false }));
        const cloned = (body.data?.cloned_voices || []).map((v) => ({ ...(v as object), is_clone: true }));
        let all: any[] = [...builtIn, ...cloned];

        if (params.is_clone !== undefined) {
          all = all.filter((v) => v.is_clone === params.is_clone);
        }
        if (params.search) {
          const needle = params.search.toLowerCase();
          all = all.filter((v) => String(v.name || "").toLowerCase().includes(needle));
        }

        const total = all.length;
        const page = all.slice(params.offset, params.offset + params.limit);
        const hasMore = params.offset + page.length < total;

        const formatted = formatVoiceList(
          page,
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

  // Get voice details
  server.registerTool(
    "sixtydb_get_voice",
    {
      title: "Get Voice Details",
      description: `Get detailed information about a specific voice by ID (\`GET /voices/{id}\`).

**Parameters:**
- id (string, required): Voice ID — the \`voice_id\` returned by sixtydb_list_voices
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Error Handling:**
- Returns "Error: Voice not found" if voice ID doesn't exist (404 status)
- Returns "Error: Authentication required" if the API key is invalid`,
      inputSchema: VoiceGetSchema,
      annotations: {
        title: "Get Voice Details",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: VoiceGetParams) => {
      try {
        const apiClient = getApiClient();

        const body = await apiClient.get<{ success: boolean; data?: unknown }>(`/voices/${encodeURIComponent(params.id)}`);

        const formatted = formatVoice(body.data, params.response_format);

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

  // Create/Clone voice
  server.registerTool(
    "sixtydb_create_voice",
    {
      title: "Create Cloned Voice",
      description: `Create a new cloned voice from a sample audio recording (\`POST /voices\`, multipart upload).

The sample audio is downloaded from \`sample_audio_url\` and re-uploaded to the API — the backend only accepts a file upload, not a URL field. This is synchronous and can take **1-3 minutes** (the backend transcribes the sample and calls the voice-cloning provider before responding — there is no job ID to poll).

**Note:** requires a non-empty workspace wallet balance and counts against the workspace's zero-shot voice creation limit (plan-dependent).

**Parameters:**
- name (string, required): Name for the cloned voice (1-100 characters)
- sample_audio_url (string, required): Public URL to a clear speech sample (mp3/wav/m4a/flac/ogg, under 25MB (the API itself allows up to 200MB, but this tool caps the download at 25MB), 10-30s recommended)
- language (string, optional): Language code (e.g., 'en', 'hi')
- dialect (string, optional): Dialect variant
- gender (string, optional): Voice gender (e.g., 'male', 'female')
- description (string, optional): Short description of the voice
- is_public (boolean, optional): Make voice publicly available (default: false)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:** the new voice's \`voice_id\`, \`name\`, and \`sample_url\`.

**Error Handling:**
- Returns "Error: ... Workspace wallet is empty" (402) if the wallet has no balance
- Returns "Error: ... limit reached" (429) if the zero-shot voice cap is hit
- Returns "Error: Invalid audio URL" if the sample audio is inaccessible
- Returns "Error: Authentication required" if the API key is invalid`,
      inputSchema: VoiceCreateSchema,
      annotations: {
        title: "Create Cloned Voice",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: VoiceCreateParams) => {
      try {
        const sample = await downloadAudioSample(params.sample_audio_url);

        const form = new FormData();
        form.append("audio_file", sample.buffer, {
          filename: sample.filename,
          contentType: sample.contentType
        });
        form.append("name", params.name);
        if (params.language) form.append("language", params.language);
        if (params.dialect) form.append("dialect", params.dialect);
        if (params.gender) form.append("gender", params.gender);
        if (params.description) form.append("description", params.description);
        form.append("is_public", String(params.is_public ?? false));

        const axiosInstance = getApiClient().getAxiosInstance();
        const response = await axiosInstance.post<{ success: boolean; message?: string; data?: unknown }>(
          "/voices",
          form,
          {
            headers: form.getHeaders(),
            timeout: 180_000,
            maxContentLength: 200 * 1024 * 1024,
            maxBodyLength: 200 * 1024 * 1024
          }
        );

        const formatted = formatVoice(response.data.data, params.response_format);

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
