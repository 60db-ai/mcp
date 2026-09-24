/**
 * Music (Song) Tools
 *
 * Exposes 60db's AI song generation API via MCP:
 *   - Create a song from a text prompt (simple mode) or full control over
 *     style + lyrics source (advanced mode)
 *   - Poll generation status until the song is ready
 *   - List, search, download and delete songs
 *   - Browse the voice catalog usable for vocals
 *
 * Song generation is asynchronous (about 1.5-2.5 minutes) and free during
 * beta. Only one generation runs at a time per workspace — a second create
 * while one is running returns 429.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs";
import path from "path";
import {
  MusicCreateSongSchema,
  MusicGetSongSchema,
  MusicListSongsSchema,
  MusicDownloadSongSchema,
  MusicListVoicesSchema,
  MusicDeleteSongSchema,
  MusicCreateSongParams,
  MusicGetSongParams,
  MusicListSongsParams,
  MusicDownloadSongParams,
  MusicListVoicesParams,
  MusicDeleteSongParams,
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import { formatErrorMessage, truncateIfNeeded } from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

// ─ Local helpers ───────────────────────────────────────────

function respond(markdown: string, json: unknown, format: ResponseFormat) {
  const body = format === ResponseFormat.JSON
    ? JSON.stringify(json, null, 2)
    : markdown;
  const { content } = truncateIfNeeded(body, format === ResponseFormat.JSON);
  return { content: [{ type: "text" as const, text: content }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "unknown";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function fmtSongLine(s: any): string {
  return [
    `- \`${s.id}\` — **${s.status}**${s.progress ? ` (${s.progress})` : ""}`,
    s.title ? ` — "${s.title}"` : "",
    s.duration_seconds != null ? ` — ${fmtDuration(s.duration_seconds)}` : "",
    s.instrumental ? " — instrumental" : "",
  ].join("");
}

function fmtSongDetail(s: any, format: ResponseFormat): string {
  const lines = [
    `**Song** \`${s.id}\``,
    `Status: **${s.status}**${s.progress ? ` — ${s.progress}` : ""}`,
    s.title ? `Title: ${s.title}` : null,
    `Mode: ${s.mode}`,
    s.duration_seconds != null ? `Duration: ${fmtDuration(s.duration_seconds)}` : null,
    s.instrumental ? "Instrumental: yes" : (s.vocal_gender ? `Vocal gender: ${s.vocal_gender}` : null),
    s.error_message ? `Error: ${s.error_message}` : null,
    s.audio_url ? `Audio URL (signed, ~1h): ${s.audio_url}` : null,
    s.created_at ? `Created: ${s.created_at}` : null,
    s.completed_at ? `Completed: ${s.completed_at}` : null,
  ].filter(Boolean).join("\n");

  if (s.lyrics_generated || s.lyrics) {
    return lines + `\n\n**Lyrics:**\n${s.lyrics_generated || s.lyrics}`;
  }
  return lines;
}

// ─ Tool registration ──────────────────────────────────────

export function registerMusicTools(server: McpServer): void {
  // ── sixtydb_music_create_song ──────────────────────────
  server.registerTool(
    "sixtydb_music_create_song",
    {
      title: "Create a song",
      description: `Generate a new AI song from a text prompt. **Free during beta** — no credit check, no wallet deduction.

Generation is asynchronous and takes about **1.5-2.5 minutes**. This call returns immediately with a song ID and status \`submitted\`/\`running\`; poll \`sixtydb_music_get_song\` every few seconds until \`status\` is \`succeeded\` or \`failed\`.

**Limits:**
- Each create makes exactly **1 song**.
- Only **one generation runs at a time per workspace** — calling this again while one is in progress returns **429**.

**Parameters:**
- \`prompt\` (string, required, 1-2000 chars): Simple mode — the song description. Advanced mode — the style (genre, mood, instruments, BPM).
- \`mode\` ('simple' | 'advanced', optional, default 'simple'): Simple writes lyrics for you from \`prompt\`. Advanced gives full control over the lyrics source.
- \`lyrics\` (string, optional, ≤12000 chars): Your own lyrics ([Verse]/[Chorus] tags allowed). Advanced mode only.
- \`lyrics_prompt\` (string, optional, ≤2000 chars): "Write lyrics for me" — the topic/idea. Advanced mode only.
- \`instrumental\` (boolean, optional, default false): Skip lyrics entirely.
- \`vocal_gender\` ('Male' | 'Female', optional)
- \`voice_id\` (string, optional): A catalog or saved voice ID — see \`sixtydb_music_list_voices\`.
- \`negative_tags\` (string, optional, ≤1000 chars): Styles to exclude.
- \`target_duration\` (number, optional, 10-600 seconds): Treated as a hint by the model.
- \`seed\` (string, optional): Digit string for repeatable results (send as a string — it's 64-bit).

**Important:** in \`advanced\` mode you must supply **exactly one** of \`lyrics\` or \`lyrics_prompt\` unless \`instrumental: true\`. Supplying both, or neither without instrumental, is rejected before any API call.

**Returns:** the new song's ID and initial status.

**Examples:**
- Simple: \`{ "prompt": "An upbeat pop song about summer road trips" }\`
- Advanced with own lyrics: \`{ "mode": "advanced", "prompt": "acoustic folk, warm, fingerpicked guitar", "lyrics": "[Verse]\\n..." }\`
- Instrumental: \`{ "mode": "advanced", "prompt": "lo-fi hip hop beat, rainy night", "instrumental": true }\`

**Use Cases:**
- Generate background music for a video or podcast intro
- Turn a set of lyrics into a full song
- Prototype a jingle or theme idea

**Error Handling:**
- 400: validation error (bad prompt/lyrics combination) — message explains the problem
- 403: the requested \`voice_id\` isn't usable by your workspace
- 429: a song is already being generated — wait for it to finish (poll \`sixtydb_music_get_song\`) before retrying
- 502/503: the song service is temporarily unavailable — retry later`,
      inputSchema: MusicCreateSongSchema,
      annotations: {
        title: "Create song",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: MusicCreateSongParams) => {
      try {
        if (params.mode === "advanced" && !params.instrumental) {
          const hasLyrics = !!params.lyrics;
          const hasLyricsPrompt = !!params.lyrics_prompt;
          if (hasLyrics === hasLyricsPrompt) {
            return errorResult(
              hasLyrics
                ? "**Error**: Advanced mode accepts only one lyrics source — provide either `lyrics` or `lyrics_prompt`, not both."
                : "**Error**: Advanced mode needs a lyrics source — provide `lyrics` or `lyrics_prompt`, or set `instrumental: true`."
            );
          }
        }

        const body: Record<string, unknown> = {
          mode: params.mode,
          prompt: params.prompt,
          instrumental: params.instrumental,
        };
        if (params.lyrics) body.lyrics = params.lyrics;
        if (params.lyrics_prompt) body.lyrics_prompt = params.lyrics_prompt;
        if (params.vocal_gender) body.vocal_gender = params.vocal_gender;
        if (params.voice_id) body.voice_id = params.voice_id;
        if (params.negative_tags) body.negative_tags = params.negative_tags;
        if (params.target_duration != null) body.target_duration = params.target_duration;
        if (params.seed) body.seed = params.seed;

        const apiClient = getApiClient();
        const data = await apiClient.post<any>("/songs", body);

        if (!data?.success) {
          return respond(`**Song creation failed**: ${data?.message || "unknown error"}`, data, params.response_format);
        }
        const info = data.data || {};
        const songs = info.songs || [];
        const md = [
          `**Song queued** (batch \`${info.batch_id || "?"}\`)`,
          data.message ? `_${data.message}_` : null,
          ...songs.map(fmtSongLine),
          "",
          "Poll `sixtydb_music_get_song` with the song ID above (every 3-5s) until status is `succeeded` or `failed`.",
          ...(info.warnings || []).map((w: string) => `- Warning: ${w}`),
        ].filter(Boolean).join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_music_get_song ─────────────────────────────
  server.registerTool(
    "sixtydb_music_get_song",
    {
      title: "Get song status/details",
      description: `Fetch a single song's current status and (once ready) its details. This is the **polling tool** for \`sixtydb_music_create_song\`.

Status flow: \`submitted\` → \`running\` → \`succeeded\` | \`failed\`. Poll every 3-5 seconds until terminal.

**Parameters:**
- \`song_id\` (string, required)

**Returns:** status/progress, and once \`succeeded\`: title, duration, generated lyrics, and a signed \`audio_url\` (expires in ~1 hour — it is re-signed on every call, so re-fetch rather than caching it; for a permanent copy use \`sixtydb_music_download_song\`).

**Error Handling:**
- 404: song not found (wrong ID, or it belongs to a different workspace)`,
      inputSchema: MusicGetSongSchema,
      annotations: {
        title: "Get song",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MusicGetSongParams) => {
      try {
        const apiClient = getApiClient();
        const data = await apiClient.get<any>(`/songs/${encodeURIComponent(params.song_id)}`);
        if (!data?.success) {
          return respond(`**Fetch failed**: ${data?.message || "unknown"}`, data, params.response_format);
        }
        const s = data.data || {};
        return respond(fmtSongDetail(s, params.response_format), data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_music_list_songs ───────────────────────────
  server.registerTool(
    "sixtydb_music_list_songs",
    {
      title: "List songs",
      description: `List songs in the workspace, newest first, with search and filters. List items omit lyrics — use \`sixtydb_music_get_song\` for full detail.

**Parameters:**
- \`q\` (string, optional): Search over title, prompt and tags
- \`status\` ('generating' | 'ready' | 'failed', optional)
- \`type\` ('vocal' | 'instrumental', optional)
- \`liked\` (boolean, optional)
- \`sort\` ('newest' | 'oldest', optional, default 'newest')
- \`limit\` (number, optional, 1-100, default 20)
- \`offset\` (number, optional, default 0)

**Examples:**
- Recent ready songs: \`{ "status": "ready", "limit": 10 }\`
- Search: \`{ "q": "road trip" }\``,
      inputSchema: MusicListSongsSchema,
      annotations: {
        title: "List songs",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MusicListSongsParams) => {
      try {
        const apiClient = getApiClient();
        const queryParams: Record<string, unknown> = {
          limit: params.limit,
          offset: params.offset,
          sort: params.sort,
        };
        if (params.q) queryParams.q = params.q;
        if (params.status) queryParams.status = params.status;
        if (params.type) queryParams.type = params.type;
        if (params.liked != null) queryParams.liked = params.liked;

        const data = await apiClient.get<any>("/songs", queryParams);
        if (!data?.success) {
          return respond(`**List failed**: ${data?.message || "unknown"}`, data, params.response_format);
        }
        const d = data.data || {};
        const songs = d.songs || [];
        const md = [
          `**Songs** (${d.total ?? songs.length} total, showing ${songs.length} at offset ${d.offset ?? params.offset})`,
          "",
          ...songs.map(fmtSongLine),
          d.has_more ? `\n---\n**More available.** Use offset=${(d.offset ?? params.offset) + songs.length}.` : null,
        ].filter(Boolean).join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_music_download_song ────────────────────────
  server.registerTool(
    "sixtydb_music_download_song",
    {
      title: "Download a song's MP3",
      description: `Get the finished MP3 for a song. Either saves it to a local file, or returns a fresh signed URL.

**Parameters:**
- \`song_id\` (string, required)
- \`output_path\` (string, optional): Absolute local filesystem path ending in \`.mp3\`. If given, the MP3 bytes are downloaded and written there and the tool returns the path + file size. If omitted, the tool fetches the song and returns its current signed \`audio_url\` instead (valid ~1 hour) — it never inlines base64 audio into the response.

**Returns:** either \`{ path, bytes }\` or \`{ audio_url }\`.

**Error Handling:**
- 409: the song isn't ready yet — check \`sixtydb_music_get_song\` first
- 404: song not found`,
      inputSchema: MusicDownloadSongSchema,
      annotations: {
        title: "Download song",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MusicDownloadSongParams) => {
      try {
        if (!params.output_path) {
          const apiClient = getApiClient();
          const data = await apiClient.get<any>(`/songs/${encodeURIComponent(params.song_id)}`);
          if (!data?.success) {
            return respond(`**Fetch failed**: ${data?.message || "unknown"}`, data, params.response_format);
          }
          const s = data.data || {};
          if (!s.audio_url) {
            return errorResult(`**Song not ready**: status is \`${s.status}\`. Poll \`sixtydb_music_get_song\` until \`succeeded\`.`);
          }
          return respond(
            `**Audio URL** (signed, ~1h): ${s.audio_url}`,
            { song_id: params.song_id, audio_url: s.audio_url },
            params.response_format
          );
        }

        if (!path.isAbsolute(params.output_path) || !params.output_path.toLowerCase().endsWith(".mp3")) {
          return errorResult("**Error**: `output_path` must be an absolute filesystem path ending in `.mp3`.");
        }

        const axiosInstance = getApiClient().getAxiosInstance();
        const res = await axiosInstance.get(`/songs/${encodeURIComponent(params.song_id)}/download`, {
          responseType: "arraybuffer",
          timeout: 120_000,
        });
        const buffer = Buffer.from(res.data);
        fs.mkdirSync(path.dirname(params.output_path), { recursive: true });
        fs.writeFileSync(params.output_path, buffer);

        return respond(
          `**Downloaded**: \`${params.output_path}\` (${(buffer.length / 1024).toFixed(1)} KB)`,
          { song_id: params.song_id, path: params.output_path, bytes: buffer.length },
          params.response_format
        );
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_music_list_voices ──────────────────────────
  server.registerTool(
    "sixtydb_music_list_voices",
    {
      title: "List music voices",
      description: `List vocal voices usable for song generation: the shared catalog plus any voices your workspace has saved.

**Parameters:**
- \`search\` (string, optional): Case-insensitive substring filter over voice name (applied client-side, across both catalog and saved voices)
- \`limit\` (number, optional, default 50): Max voices to return after filtering

**Returns:** each voice's \`voice_id\`, \`name\`, \`gender\`, \`language\`, and (catalog voices only) a public \`preview_url\` sample clip.

**Use Cases:**
- Pick a \`voice_id\` to pass to \`sixtydb_music_create_song\`
- Preview available catalog voices before generating`,
      inputSchema: MusicListVoicesSchema,
      annotations: {
        title: "List voices",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MusicListVoicesParams) => {
      try {
        const apiClient = getApiClient();
        const data = await apiClient.get<any>("/songs/voices");
        if (!data?.success) {
          return respond(`**Fetch failed**: ${data?.message || "unknown"}`, data, params.response_format);
        }
        const d = data.data || {};
        const catalog = (d.catalog || []).map((v: any) => ({ ...v, source: "catalog" }));
        const mine = (d.mine || []).map((v: any) => ({ ...v, source: "mine" }));
        let voices = [...catalog, ...mine];

        if (params.search) {
          const needle = params.search.toLowerCase();
          voices = voices.filter((v) => (v.name || "").toLowerCase().includes(needle));
        }
        voices = voices.slice(0, params.limit);

        const md = [
          `**Voices** (${voices.length} shown${params.search ? ` matching "${params.search}"` : ""})`,
          "",
          ...voices.map((v) =>
            `- \`${v.voice_id}\` — **${v.name}**${v.gender ? ` (${v.gender})` : ""}${v.language ? ` [${v.language}]` : ""} — ${v.source}${v.preview_url ? ` — preview: ${v.preview_url}` : ""}`
          ),
        ].join("\n");
        return respond(md, { ...data, filtered: voices }, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );

  // ── sixtydb_music_delete_song ──────────────────────────
  server.registerTool(
    "sixtydb_music_delete_song",
    {
      title: "Delete a song",
      description: `Move a song to trash (soft delete).

**Parameters:**
- \`song_id\` (string, required)

**Error Handling:**
- 404: song not found`,
      inputSchema: MusicDeleteSongSchema,
      annotations: {
        title: "Delete song",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MusicDeleteSongParams) => {
      try {
        const apiClient = getApiClient();
        const data = await apiClient.delete<any>(`/songs/${encodeURIComponent(params.song_id)}`);
        if (!data?.success) {
          return respond(`**Delete failed**: ${data?.message || "unknown"}`, data, params.response_format);
        }
        return respond(`**Song moved to trash**: \`${params.song_id}\``, data, params.response_format);
      } catch (error) {
        return errorResult(formatErrorMessage(error as Error));
      }
    }
  );
}
