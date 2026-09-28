/**
 * Response Formatters
 * Handles formatting responses in both JSON and Markdown formats
 */

import { ResponseFormat } from "../types/index.js";
import { CHARACTER_LIMIT } from "../constants.js";

/**
 * Format date to human-readable string
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toISOString().replace("T", " ").substring(0, 19) + " UTC";
  } catch {
    return dateString;
  }
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "unknown";
  const s = Math.round(seconds);
  if (s < 60) {
    return `${s}s`;
  } else if (s < 3600) {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

/** Format a USD cost value (the API bills in dollars, not "credits"). */
function formatCost(usd: unknown): string {
  const n = typeof usd === "number" ? usd : parseFloat(String(usd));
  return Number.isFinite(n) ? `$${n.toFixed(6)}` : "unknown";
}

/**
 * Format file size to human-readable string
 */
function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Truncate response if it exceeds character limit
 */
export function truncateIfNeeded(
  response: string,
  isJson: boolean
): { content: string; truncated: boolean; truncationMessage?: string } {
  if (response.length <= CHARACTER_LIMIT) {
    return { content: response, truncated: false };
  }

  const truncationMessage = isJson
    ? `\n  "truncated": true,\n  "truncation_message": "Response truncated due to size. Use pagination or filters to reduce results."`
    : `\n\n---\n**Response truncated due to size.** Use pagination or filters to reduce results.`;

  // Keep content within limit, leaving room for truncation message
  const availableSpace = CHARACTER_LIMIT - truncationMessage.length - 100;
  const truncatedContent = response.substring(0, availableSpace) + "...";

  return {
    content: truncatedContent + truncationMessage,
    truncated: true,
    truncationMessage: "Response truncated. Use pagination or filters to reduce results."
  };
}

/**
 * Format a single voice.
 *
 * Real shape (GET /voices/{id} -> data): { voice_id, name, category,
 * model, labels?, description?, preview_url?, reference_text?, is_native?,
 * available_for_tiers?, categories? } — plus, for voices this workspace
 * owns, local enrichment: { access_level, creator_name, workspace_name,
 * is_public, language, dialect, gender, accent, sample_url, created_at }.
 * The upstream catalog does NOT expose a `language`/`gender` field on most
 * built-in voices — only locally-owned rows do.
 */
export function formatVoice(
  voice: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(voice, null, 2);
  }

  const id = voice?.voice_id ?? voice?.id ?? "unknown";
  const name = voice?.name ?? "Unnamed voice";
  const language = voice?.language ?? voice?.labels?.language;
  const gender = voice?.gender ?? voice?.labels?.gender;
  const preview = voice?.preview_url ?? voice?.sample_url;

  const lines: string[] = [];
  lines.push(`## ${name} (${id})`);
  lines.push("");
  if (language) lines.push(`- **Language**: ${language}${voice?.dialect ? ` (${voice.dialect})` : ""}`);
  if (gender) lines.push(`- **Gender**: ${gender}`);
  if (voice?.category) lines.push(`- **Category**: ${voice.category}`);
  if (voice?.model) lines.push(`- **Model**: ${voice.model}`);
  if (typeof voice?.is_public === "boolean") lines.push(`- **Visibility**: ${voice.is_public ? "Public" : "Private"}`);
  if (voice?.description) lines.push(`- **Description**: ${voice.description}`);
  if (preview) lines.push(`- **Preview**: ${preview}`);
  if (voice?.created_at) lines.push(`- **Created**: ${formatDate(voice.created_at)}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Format a voice list. `voices` are the combined + client-filtered array
 * built by the list tool (each item tagged with `is_clone`); pagination
 * (total/offset/has_more) is also computed client-side since GET /get-voices
 * returns the full catalog with no server-side pagination or search.
 */
export function formatVoiceList(
  voices: any[],
  total: number,
  offset: number,
  hasMore: boolean,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    const response = {
      total,
      count: voices.length,
      offset,
      voices,
      has_more: hasMore,
      next_offset: hasMore ? offset + voices.length : undefined
    };
    return JSON.stringify(response, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Voices (${total} matching)`);
  lines.push("");
  lines.push(`Showing ${voices.length} voices (offset: ${offset})`);
  lines.push("");

  for (const voice of voices) {
    const id = voice?.voice_id ?? voice?.id ?? "unknown";
    const language = voice?.language ?? voice?.labels?.language;
    lines.push(`### ${voice?.name ?? "Unnamed voice"} (${id})`);
    if (language) lines.push(`- **Language**: ${language}`);
    if (voice?.category) lines.push(`- **Category**: ${voice.category}`);
    lines.push(`- **Type**: ${voice?.is_clone ? "Cloned/your voice" : "Built-in catalog"}`);
    const preview = voice?.preview_url ?? voice?.sample_url;
    if (preview) lines.push(`- **Preview**: ${preview}`);
    lines.push("");
  }

  if (hasMore) {
    lines.push(`---\n**More results available.** Use offset=${offset + voices.length} to see more.`);
  }

  return lines.join("\n");
}

/**
 * Format a single TTS log entry.
 *
 * Real shape (GET /tts/{id} -> data, a `tts_logs` row): { id, hash_id,
 * input_text, characters, duration_seconds, cost_usd, status,
 * error_message, output_url, created_at, voice_name, voice_language }.
 * `output_url`/audio is usually null — synthesis audio is streamed back at
 * generation time and not persisted server-side, so history rows are
 * text/metadata only.
 */
export function formatTTSLog(
  log: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(log, null, 2);
  }

  const id = log?.hash_id ?? log?.id ?? "unknown";
  const text: string = log?.input_text ?? log?.text ?? "";

  const lines: string[] = [];
  lines.push(`## TTS Generation ${id}`);
  lines.push("");
  lines.push(`- **Text**: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);
  lines.push(`- **Voice**: ${log?.voice_name ?? log?.voice_id ?? "unknown"}`);
  lines.push(`- **Status**: ${log?.status ?? "unknown"}`);
  lines.push(`- **Duration**: ${formatDuration(log?.duration_seconds)}`);
  lines.push(`- **Cost**: ${formatCost(log?.cost_usd)}`);
  if (log?.created_at) lines.push(`- **Created**: ${formatDate(log.created_at)}`);
  if (log?.output_url) {
    lines.push(`- **Audio**: ${log.output_url}`);
  } else {
    lines.push(`- **Audio**: not persisted (audio was only returned at generation time)`);
  }
  if (log?.error_message) lines.push(`- **Error**: ${log.error_message}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Real shape (GET /tts/logs): top-level `{ logs: [...], pagination: {
 * page, limit, total, pages } }` — not `{ data: { logs, total } }`.
 */
export function formatTTSLogList(
  logs: any[],
  total: number,
  offset: number,
  hasMore: boolean,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    const response = {
      total,
      count: logs.length,
      offset,
      logs,
      has_more: hasMore,
      next_offset: hasMore ? offset + logs.length : undefined
    };
    return JSON.stringify(response, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# TTS History (${total} total)`);
  lines.push("");
  lines.push(`Showing ${logs.length} generations (offset: ${offset})`);
  lines.push("");

  for (const log of logs) {
    const id = log?.hash_id ?? log?.id ?? "unknown";
    const text: string = log?.input_text ?? "";
    lines.push(`### ${id}`);
    lines.push(`- **Text**: ${text.substring(0, 80)}${text.length > 80 ? "..." : ""}`);
    lines.push(`- **Voice**: ${log?.voice_name ?? "unknown"}`);
    lines.push(`- **Status**: ${log?.status ?? "unknown"}`);
    lines.push(`- **Duration**: ${formatDuration(log?.duration_seconds)}`);
    lines.push(`- **Cost**: ${formatCost(log?.cost_usd)}`);
    if (log?.created_at) lines.push(`- **Date**: ${formatDate(log.created_at)}`);
    lines.push("");
  }

  if (hasMore) {
    lines.push(`---\n**More results available.** Use offset=${offset + logs.length} to see more.`);
  }

  return lines.join("\n");
}

/**
 * Format a single STT result. Two possible shapes hit this function:
 * 1) The live transcription response from POST /stt (upstream passthrough):
 *    { request_id, text, language, duration_sec, segments, warning_codes,
 *      hash_id, has_audio, ... }
 * 2) A `stt_item` history row from GET /stt/{id}: { id, hash_id, transcript,
 *    language, duration_seconds, cost_usd, status, created_at, has_audio,
 *    input_audio_url (private S3 key, not a public URL) }.
 */
export function formatSTTLog(
  log: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(log, null, 2);
  }

  const id = log?.hash_id ?? log?.request_id ?? log?.id ?? "unknown";
  const text: string = log?.text ?? log?.transcript ?? "";
  const duration = log?.duration_sec ?? log?.duration_seconds;
  const language = log?.language_name ?? log?.language ?? "unknown";

  const lines: string[] = [];
  lines.push(`## Transcription ${id}`);
  lines.push("");
  lines.push(`- **Language**: ${language}`);
  lines.push(`- **Duration**: ${formatDuration(duration)}`);
  if (log?.cost_usd != null) lines.push(`- **Cost**: ${formatCost(log.cost_usd)}`);
  if (log?.status) lines.push(`- **Status**: ${log.status}`);
  if (log?.created_at) lines.push(`- **Created**: ${formatDate(log.created_at)}`);
  if (Array.isArray(log?.warning_codes) && log.warning_codes.length > 0) {
    lines.push(`- **Warnings**: ${log.warning_codes.join(", ")}`);
  }
  lines.push("");
  lines.push(`**Transcript:**`);
  lines.push(text ? `> ${text}` : "> _(empty — no speech detected)_");
  lines.push("");

  return lines.join("\n");
}

/**
 * Real shape (GET /stt/logs): top-level `{ logs: [...], pagination: {
 * page, limit, total, pages } }`, rows carry `transcript`/`text_preview`
 * (not `text`), and no `file_name` field exists.
 */
export function formatSTTLogList(
  logs: any[],
  total: number,
  offset: number,
  hasMore: boolean,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    const response = {
      total,
      count: logs.length,
      offset,
      logs,
      has_more: hasMore,
      next_offset: hasMore ? offset + logs.length : undefined
    };
    return JSON.stringify(response, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Transcriptions (${total} total)`);
  lines.push("");
  lines.push(`Showing ${logs.length} transcriptions (offset: ${offset})`);
  lines.push("");

  for (const log of logs) {
    const id = log?.hash_id ?? log?.id ?? "unknown";
    const text: string = log?.text_preview ?? log?.transcript ?? "";
    lines.push(`### ${id}`);
    lines.push(`- **Language**: ${log?.language ?? "unknown"}`);
    lines.push(`- **Duration**: ${formatDuration(log?.duration_seconds)}`);
    if (log?.cost_usd != null) lines.push(`- **Cost**: ${formatCost(log.cost_usd)}`);
    lines.push(`- **Text**: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);
    lines.push("");
  }

  if (hasMore) {
    lines.push(`---\n**More results available.** Use offset=${offset + logs.length} to see more.`);
  }

  return lines.join("\n");
}

/**
 * Format workspace.
 * Real shape (GET /workspaces list item, or POST /workspaces data): id,
 * hash_id, name, role, owner_name, created_at. There is no "description"
 * field on the backend and no single GET /workspaces/:id route — see
 * workspaces.ts (sixtydb_get_workspace filters the list client-side).
 */
export function formatWorkspace(
  workspace: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(workspace, null, 2);
  }

  const lines: string[] = [];
  lines.push(`## ${workspace.name} (${workspace.id})`);
  lines.push("");
  if (workspace.hash_id) lines.push(`- **Hash ID**: ${workspace.hash_id}`);
  if (workspace.role) lines.push(`- **Your Role**: ${workspace.role}`);
  if (workspace.owner_name) lines.push(`- **Owner**: ${workspace.owner_name}`);
  if (workspace.created_at) lines.push(`- **Created**: ${formatDate(workspace.created_at)}`);
  lines.push("");

  return lines.join("\n");
}

export function formatWorkspaceList(
  workspaces: any[],
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify({ workspaces, total: workspaces.length }, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Workspaces (${workspaces.length})`);
  lines.push("");

  for (const ws of workspaces) {
    lines.push(`### ${ws.name} (${ws.id})`);
    if (ws.role) lines.push(`- **Your Role**: ${ws.role}`);
    if (ws.owner_name) lines.push(`- **Owner**: ${ws.owner_name}`);
    if (ws.created_at) lines.push(`- **Created**: ${formatDate(ws.created_at)}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format workspace member.
 * Real shape (GET /workspaces/:id/members item): user_id, full_name, email,
 * avatar_url, role, joined_at, is_active, invitee_id.
 */
export function formatWorkspaceMember(
  member: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(member, null, 2);
  }

  const lines: string[] = [];
  lines.push(`- **${member.full_name || member.user_id}** (${member.role})`);
  lines.push(`  - User ID: ${member.user_id}`);
  if (member.email) lines.push(`  - Email: ${member.email}`);
  if (member.joined_at) lines.push(`  - Joined: ${formatDate(member.joined_at)}`);
  if (member.is_active === false) lines.push(`  - **Inactive**`);

  return lines.join("\n");
}

/**
 * Format usage stats
 */
export function formatUsageStats(
  stats: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(stats, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Usage Statistics`);
  lines.push("");

  // Handle both old and new API response formats
  if (stats.summary) {
    // New format from production API
    const { summary, period_label, workspace_id, billing_owner_id } = stats;

    lines.push(`## Account`);
    lines.push(`- **Workspace ID**: ${workspace_id || 'N/A'}`);
    lines.push(`- **Period**: ${period_label || 'N/A'}`);
    lines.push("");

    lines.push(`## Usage Summary`);
    lines.push(`- **TTS Characters**: ${(summary.tts_characters || 0).toLocaleString()}`);
    lines.push(`- **STT Minutes**: ${(summary.stt_minutes || 0).toLocaleString()}`);
    lines.push(`- **Total Cost**: $${(summary.total_cost_usd || 0).toFixed(2)}`);
    lines.push(`- **Plan**: ${summary.plan || 'Free'}`);
    lines.push("");

    if (summary.limits) {
      lines.push(`## Limits`);
      lines.push(`- **TTS Limit**: ${(summary.limits.tts_characters || 0).toLocaleString()} characters`);
      lines.push(`- **STT Limit**: ${(summary.limits.stt_minutes || 0).toLocaleString()} minutes`);

      if (summary.limits.usage_percentage) {
        lines.push(`- **TTS Used**: ${summary.limits.usage_percentage.tts || 0}%`);
        lines.push(`- **STT Used**: ${summary.limits.usage_percentage.stt || 0}%`);
      }
      lines.push("");
    }
  } else {
    // Old format (for backward compatibility)
    lines.push(`## Credits Usage`);
    lines.push(`- **TTS Credits**: ${(stats.tts_credits_used || 0).toLocaleString()}`);
    lines.push(`- **STT Credits**: ${(stats.stt_credits_used || 0).toLocaleString()}`);
    lines.push(`- **LLM Credits**: ${(stats.llm_credits_used || 0).toLocaleString()}`);
    lines.push(`- **Total Used**: ${(stats.total_credits_used || 0).toLocaleString()}`);
    lines.push(`- **Remaining**: ${(stats.credits_remaining || 0).toLocaleString()}`);
    lines.push("");

    if (stats.period) {
      lines.push(`## Period`);
      lines.push(`- **Start**: ${formatDate(stats.period.start)}`);
      lines.push(`- **End**: ${formatDate(stats.period.end)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Format invoice.
 * Real shape differs between GET /billing/invoices (list item: flat
 * plan_name/workspace_name/period_start/period_end) and GET
 * /billing/invoices/:id (single: nested plan{name,description},
 * workspace{name}, user{name,email}, period{start,end}). No `due_date`
 * field exists on either shape — billing_invoices has no due-date concept.
 */
export function formatInvoice(
  invoice: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(invoice, null, 2);
  }

  const planName = invoice.plan?.name ?? invoice.plan_name;
  const periodStart = invoice.period?.start ?? invoice.period_start;
  const periodEnd = invoice.period?.end ?? invoice.period_end;
  const amount = Number(invoice.amount) || 0;

  const lines: string[] = [];
  lines.push(`## Invoice ${invoice.id}`);
  lines.push("");
  lines.push(`- **Amount**: ${invoice.currency === "USD" ? "$" : invoice.currency + " "}${amount.toFixed(2)}`);
  lines.push(`- **Status**: ${String(invoice.status || "unknown").toUpperCase()}`);
  if (planName) lines.push(`- **Plan**: ${planName}`);
  if (periodStart) lines.push(`- **Period**: ${formatDate(periodStart)} → ${periodEnd ? formatDate(periodEnd) : "?"}`);
  if (invoice.payment_method) lines.push(`- **Payment Method**: ${invoice.payment_method}`);
  if (invoice.invoice_url) lines.push(`- **Download**: ${invoice.invoice_url}`);
  if (invoice.created_at) lines.push(`- **Created**: ${formatDate(invoice.created_at)}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Format meeting.
 * Real shape (GET /60db/meetings/:id data): id, title, platform, start_time,
 * end_time, duration_minutes, status, trigger_type, audio_url,
 * transcript: [{id,text,is_final,confidence,timestamp}], notes:
 * {id,summary,key_points,action_items,decisions,generated_at} | null.
 * There is no `ai_summary`/`ai_notes` string field — summary lives under
 * `notes.summary`.
 */
export function formatMeeting(
  meeting: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(meeting, null, 2);
  }

  const lines: string[] = [];
  lines.push(`## ${meeting.title} (${meeting.id})`);
  lines.push("");
  lines.push(`- **Status**: ${String(meeting.status || "unknown").toUpperCase()}`);
  if (meeting.platform) lines.push(`- **Platform**: ${meeting.platform}`);
  if (meeting.duration_minutes != null) lines.push(`- **Duration**: ${meeting.duration_minutes} min`);
  if (meeting.start_time) lines.push(`- **Start**: ${formatDate(meeting.start_time)}`);
  if (meeting.end_time) lines.push(`- **End**: ${formatDate(meeting.end_time)}`);
  if (meeting.audio_url) lines.push(`- **Audio**: ${meeting.audio_url}`);

  if (meeting.notes?.summary) {
    lines.push("");
    lines.push(`**AI Summary:**`);
    lines.push(`> ${meeting.notes.summary}`);
  }
  if (Array.isArray(meeting.notes?.key_points) && meeting.notes.key_points.length > 0) {
    lines.push("");
    lines.push(`**Key Points:**`);
    for (const kp of meeting.notes.key_points) lines.push(`- ${kp}`);
  }
  if (Array.isArray(meeting.transcript) && meeting.transcript.length > 0) {
    const preview = meeting.transcript.map((c: any) => c.text).join(" ").slice(0, 300);
    lines.push("");
    lines.push(`**Transcript Preview:**`);
    lines.push(`> ${preview}${preview.length >= 300 ? "..." : ""}`);
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Format meeting list.
 * Real shape (GET /60db/meetings data): { meetings: [{id, title, platform,
 * start_time, end_time, duration_minutes, status, trigger_type, has_audio,
 * has_notes}], total, page, limit } — page-based, not offset-based.
 */
export function formatMeetingList(
  meetings: any[],
  total: number,
  page: number,
  hasMore: boolean,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    const response = {
      total,
      count: meetings.length,
      page,
      meetings,
      has_more: hasMore,
      next_page: hasMore ? page + 1 : undefined
    };
    return JSON.stringify(response, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Meetings (${total} total)`);
  lines.push("");
  lines.push(`Showing ${meetings.length} meetings (page ${page})`);
  lines.push("");

  for (const meeting of meetings) {
    lines.push(`### ${meeting.title} (${meeting.id})`);
    lines.push(`- **Status**: ${String(meeting.status || "unknown").toUpperCase()}`);
    if (meeting.platform) lines.push(`- **Platform**: ${meeting.platform}`);
    if (meeting.duration_minutes != null) lines.push(`- **Duration**: ${meeting.duration_minutes} min`);
    if (meeting.start_time) lines.push(`- **Start**: ${formatDate(meeting.start_time)}`);
    lines.push(`- **Has notes**: ${meeting.has_notes ? "yes" : "no"} | **Has audio**: ${meeting.has_audio ? "yes" : "no"}`);
    lines.push("");
  }

  if (hasMore) {
    lines.push(`---\n**More results available.** Use page=${page + 1} to see more.`);
  }

  return lines.join("\n");
}

/**
 * Format note.
 * Real shape (60db/notes row): id, title, content, tag (singular string,
 * not a `tags` array), timestamp, createdAt, updatedAt.
 */
export function formatNote(
  note: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(note, null, 2);
  }

  const lines: string[] = [];
  lines.push(`## ${note.title || "(untitled)"} (${note.id})`);
  lines.push("");
  if (note.tag) {
    lines.push(`**Tag**: \`${note.tag}\``);
    lines.push("");
  }
  lines.push(note.content || "");
  lines.push("");
  const created = note.createdAt ?? note.created_at;
  const updated = note.updatedAt ?? note.updated_at;
  if (created || updated) {
    lines.push(`*Created: ${created ? formatDate(created) : "?"}${updated ? ` | Updated: ${formatDate(updated)}` : ""}*`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format dictionary entry.
 * Real shape (60db_dictionary row): id, term, replacement, tag, scope,
 * createdBy, createdAt. There is no `phrase` or `voice_id` field.
 */
export function formatDictionaryEntry(
  entry: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(entry, null, 2);
  }

  const lines: string[] = [];
  lines.push(`- **"${entry.term}"** → **"${entry.replacement}"**`);
  lines.push(`  - Scope: ${entry.scope}`);
  lines.push(`  - ID: ${entry.id}`);
  if (entry.tag) lines.push(`  - Tag: ${entry.tag}`);

  return lines.join("\n");
}

/**
 * Format snippet.
 * Real shape (60db_snippets row): id, title, content, tag, scope,
 * createdBy, createdAt. There is no `category` field (renamed to `tag`).
 */
export function formatSnippet(
  snippet: any,
  format: ResponseFormat
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(snippet, null, 2);
  }

  const lines: string[] = [];
  lines.push(`### ${snippet.title} (${snippet.id})`);
  if (snippet.tag) lines.push(`**Tag**: ${snippet.tag}`);
  if (snippet.scope) lines.push(`**Scope**: ${snippet.scope}`);
  lines.push("");
  lines.push(snippet.content);
  lines.push("");
  if (snippet.createdAt || snippet.created_at) {
    lines.push(`*Created: ${formatDate(snippet.createdAt ?? snippet.created_at)}*`);
    lines.push("");
  }

  return lines.join("\n");
}

// Import types for formatErrorMessage
import { ApiError, RateLimitError } from "../types/index.js";

/**
 * Format error message
 */
export function formatErrorMessage(error: Error): string {
  let message = `**Error**: ${error.message}`;

  if (error instanceof ApiError && error.details) {
    message += `\n\n**Details**: ${JSON.stringify(error.details, null, 2)}`;
  }

  if (error instanceof RateLimitError && error.retryAfter) {
    message += `\n\n**Retry after**: ${error.retryAfter} seconds`;
  }

  return message;
}
