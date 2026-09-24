/**
 * Zod Schemas for Input Validation
 */

import { z } from "zod";
import { ResponseFormat } from "../types/index.js";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_OFFSET,
  TTS_MAX_TEXT_LENGTH,
  TTS_MIN_SPEED,
  TTS_MAX_SPEED,
  TTS_MIN_STABILITY,
  TTS_MAX_STABILITY,
  TTS_MIN_SIMILARITY,
  TTS_MAX_SIMILARITY,
  VOICE_NAME_MIN_LENGTH,
  VOICE_NAME_MAX_LENGTH,
  WORKSPACE_NAME_MIN_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_DESC_MAX_LENGTH,
  DICTIONARY_PHRASE_MAX_LENGTH,
  DICTIONARY_REPLACEMENT_MAX_LENGTH,
  SNIPPET_TITLE_MAX_LENGTH,
  SNIPPET_CONTENT_MAX_LENGTH,
  SNIPPET_CATEGORY_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  NOTE_CONTENT_MAX_LENGTH,
  NOTE_TAGS_MAX_COUNT,
  NOTE_TAG_MAX_LENGTH,
  MEETING_TITLE_MAX_LENGTH,
  MUSIC_PROMPT_MAX_LENGTH,
  MUSIC_LYRICS_MAX_LENGTH,
  MUSIC_LYRICS_PROMPT_MAX_LENGTH,
  MUSIC_NEGATIVE_TAGS_MAX_LENGTH,
  MUSIC_VOICE_ID_MAX_LENGTH,
  MUSIC_TARGET_DURATION_MIN,
  MUSIC_TARGET_DURATION_MAX,
  MUSIC_SEED_MAX_LENGTH,
  MUSIC_LIST_VOICES_DEFAULT_LIMIT,
  MUSIC_LIST_VOICES_MAX_LIMIT,
  E164_REGEX,
  DIALER_LOGS_MAX_LIMIT,
  DIALER_LOGS_DEFAULT_LIMIT,
  DIALER_RECORDINGS_MAX_LIMIT,
  DIALER_RECORDINGS_DEFAULT_LIMIT,
  DIALER_USAGE_MAX_LIMIT,
  DIALER_USAGE_DEFAULT_LIMIT
} from "../constants.js";

// ============================================================================
// Shared Schemas
// ============================================================================

export const ResponseFormatSchema = z.nativeEnum(ResponseFormat);

export const PaginationSchema = z.object({
  limit: z.number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(MAX_LIMIT, `Limit must not exceed ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT)
    .describe("Maximum number of results to return"),
  offset: z.number()
    .int()
    .min(0, "Offset must be non-negative")
    .default(DEFAULT_OFFSET)
    .describe("Number of results to skip for pagination"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable")
}).strict();

export type PaginationParams = z.infer<typeof PaginationSchema>;

// ============================================================================
// Voice Schemas
// ============================================================================

export const VoiceListSchema = z.object({
  workspace_id: z.string().optional().describe("Filter by workspace ID"),
  language: z.string().optional().describe("Filter by language code (e.g., 'en-US')"),
  dialect: z.string().optional().describe("Filter by dialect"),
  is_public: z.boolean().optional().describe("Filter public/private voices"),
  is_clone: z.boolean().optional().describe("Filter cloned/standard voices"),
  search: z.string().optional().describe("Search term for voice names"),
  ...PaginationSchema.shape
}).strict();

export type VoiceListParams = z.infer<typeof VoiceListSchema>;

export const VoiceGetSchema = z.object({
  id: z.string().describe("Voice ID to retrieve"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type VoiceGetParams = z.infer<typeof VoiceGetSchema>;

export const VoiceCreateSchema = z.object({
  name: z.string()
    .min(VOICE_NAME_MIN_LENGTH, "Voice name is required")
    .max(VOICE_NAME_MAX_LENGTH, `Voice name must not exceed ${VOICE_NAME_MAX_LENGTH} characters`)
    .describe("Name for the cloned voice"),
  sample_audio_url: z.string().url().describe("URL to sample audio for voice cloning"),
  language: z.string().optional().describe("Language code (e.g., 'en-US')"),
  dialect: z.string().optional().describe("Dialect variant"),
  is_public: z.boolean().default(false).describe("Make voice publicly available"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type VoiceCreateParams = z.infer<typeof VoiceCreateSchema>;

// ============================================================================
// TTS Schemas
// ============================================================================

export const TTSSynthesizeSchema = z.object({
  text: z.string()
    .min(1, "Text is required")
    .max(TTS_MAX_TEXT_LENGTH, `Text must not exceed ${TTS_MAX_TEXT_LENGTH} characters`)
    .describe("Text to convert to speech"),
  voice_id: z.string().describe("Voice ID to use for synthesis"),
  speed: z.number()
    .min(TTS_MIN_SPEED, `Speed must be at least ${TTS_MIN_SPEED}`)
    .max(TTS_MAX_SPEED, `Speed must not exceed ${TTS_MAX_SPEED}`)
    .optional()
    .describe("Speech speed multiplier"),
  stability: z.number()
    .min(TTS_MIN_STABILITY, `Stability must be at least ${TTS_MIN_STABILITY}`)
    .max(TTS_MAX_STABILITY, `Stability must not exceed ${TTS_MAX_STABILITY}`)
    .optional()
    .describe("Voice stability 0-100 (default 50)"),
  similarity: z.number()
    .min(TTS_MIN_SIMILARITY, `Similarity must be at least ${TTS_MIN_SIMILARITY}`)
    .max(TTS_MAX_SIMILARITY, `Similarity must not exceed ${TTS_MAX_SIMILARITY}`)
    .optional()
    .describe("Voice similarity 0-100 (default 75)"),
  output_format: z.enum(["mp3", "wav", "ogg"]).optional().describe("Audio output format"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type TTSSynthesizeParams = z.infer<typeof TTSSynthesizeSchema>;

export const TTSLogsSchema = z.object({
  voice_id: z.string().optional().describe("Filter by voice ID"),
  from_date: z.string().datetime().optional().describe("Filter by start date (ISO 8601)"),
  to_date: z.string().datetime().optional().describe("Filter by end date (ISO 8601)"),
  ...PaginationSchema.shape
}).strict();

export type TTSLogsParams = z.infer<typeof TTSLogsSchema>;

export const TTSGetSchema = z.object({
  id: z.string().describe("TTS generation ID"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type TTSGetParams = z.infer<typeof TTSGetSchema>;

// ============================================================================
// STT Schemas
// ============================================================================

export const STTTranscribeSchema = z.object({
  audio_url: z.string().url().describe("URL to audio file to transcribe (downloaded and forwarded as multipart/form-data to POST /stt)"),
  language: z.string().optional().describe(
    "ISO 639-1 language code (e.g. 'en', 'hi', 'ar'). Omit this field OR " +
    "pass 'auto' to enable auto-detection across the 39 supported languages. " +
    "Do NOT pass 'auto' to the WebSocket endpoint — that form requires `null`."
  ),
  diarize: z.boolean().optional().describe(
    "Enable speaker diarization. When true, each segment in the response " +
    "includes a `speakers` array with SPEAKER_00, SPEAKER_01, … labels."
  ),
  context: z.string().optional().describe(
    "Free-form string describing the session / domain / speakers / jargon " +
    "(e.g. 'Cricket coaching session. Players: Arjun Mehta, Ishaan Verma. " +
    "Discussing batting technique.'). When supplied, the server runs a " +
    "background LLM refinement pass and the response text is polished for " +
    "proper nouns, filler removal, and punctuation. Omit to skip refinement. " +
    "NOTE: this is the REST /v1/transcribe shape — the WebSocket /v1/stream " +
    "endpoint takes a structured {general, text, terms} object instead."
  ),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type STTTranscribeParams = z.infer<typeof STTTranscribeSchema>;

export const STTLogsSchema = z.object({
  language: z.string().optional().describe("Filter by language"),
  from_date: z.string().datetime().optional().describe("Filter by start date (ISO 8601)"),
  to_date: z.string().datetime().optional().describe("Filter by end date (ISO 8601)"),
  ...PaginationSchema.shape
}).strict();

export type STTLogsParams = z.infer<typeof STTLogsSchema>;

export const STTGetSchema = z.object({
  id: z.string().describe("STT transcription ID"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type STTGetParams = z.infer<typeof STTGetSchema>;

// ============================================================================
// Workspace Schemas
// ============================================================================

export const WorkspaceListSchema = z.object({
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type WorkspaceListParams = z.infer<typeof WorkspaceListSchema>;

export const WorkspaceGetSchema = z.object({
  id: z.string().describe("Workspace ID"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type WorkspaceGetParams = z.infer<typeof WorkspaceGetSchema>;

export const WorkspaceCreateSchema = z.object({
  name: z.string()
    .min(WORKSPACE_NAME_MIN_LENGTH, "Workspace name is required")
    .max(WORKSPACE_NAME_MAX_LENGTH, `Workspace name must not exceed ${WORKSPACE_NAME_MAX_LENGTH} characters`)
    .describe("Name for the workspace"),
  description: z.string()
    .max(WORKSPACE_DESC_MAX_LENGTH, `Description must not exceed ${WORKSPACE_DESC_MAX_LENGTH} characters`)
    .optional()
    .describe("Workspace description"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type WorkspaceCreateParams = z.infer<typeof WorkspaceCreateSchema>;

export const WorkspaceMembersSchema = z.object({
  workspace_id: z.string().describe("Workspace ID"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type WorkspaceMembersParams = z.infer<typeof WorkspaceMembersSchema>;

// ============================================================================
// 60DB Schemas
// ============================================================================

export const DictionaryListSchema = z.object({
  scope: z.enum(["personal", "team", "all"]).default("all").describe("Filter by scope"),
  voice_id: z.string().optional().describe("Filter by voice ID"),
  search: z.string().optional().describe("Search term for phrases"),
  ...PaginationSchema.shape
}).strict();

export type DictionaryListParams = z.infer<typeof DictionaryListSchema>;

export const DictionaryAddSchema = z.object({
  phrase: z.string()
    .min(1, "Phrase is required")
    .max(DICTIONARY_PHRASE_MAX_LENGTH, `Phrase must not exceed ${DICTIONARY_PHRASE_MAX_LENGTH} characters`)
    .describe("Phrase to replace"),
  replacement: z.string()
    .min(1, "Replacement is required")
    .max(DICTIONARY_REPLACEMENT_MAX_LENGTH, `Replacement must not exceed ${DICTIONARY_REPLACEMENT_MAX_LENGTH} characters`)
    .describe("Replacement text"),
  scope: z.enum(["personal", "team"]).default("personal").describe("Entry scope"),
  voice_id: z.string().optional().describe("Apply to specific voice only"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type DictionaryAddParams = z.infer<typeof DictionaryAddSchema>;

export const SnippetsListSchema = z.object({
  category: z.string().optional().describe("Filter by category"),
  search: z.string().optional().describe("Search term for titles/content"),
  ...PaginationSchema.shape
}).strict();

export type SnippetsListParams = z.infer<typeof SnippetsListSchema>;

export const SnippetAddSchema = z.object({
  title: z.string()
    .min(1, "Title is required")
    .max(SNIPPET_TITLE_MAX_LENGTH, `Title must not exceed ${SNIPPET_TITLE_MAX_LENGTH} characters`)
    .describe("Snippet title"),
  content: z.string()
    .min(1, "Content is required")
    .max(SNIPPET_CONTENT_MAX_LENGTH, `Content must not exceed ${SNIPPET_CONTENT_MAX_LENGTH} characters`)
    .describe("Snippet content"),
  category: z.string()
    .max(SNIPPET_CATEGORY_MAX_LENGTH, `Category must not exceed ${SNIPPET_CATEGORY_MAX_LENGTH} characters`)
    .optional()
    .describe("Snippet category"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type SnippetAddParams = z.infer<typeof SnippetAddSchema>;

export const NotesListSchema = z.object({
  tags: z.array(z.string()).optional().describe("Filter by tags"),
  search: z.string().optional().describe("Search term for titles/content"),
  ...PaginationSchema.shape
}).strict();

export type NotesListParams = z.infer<typeof NotesListSchema>;

export const NoteAddSchema = z.object({
  title: z.string()
    .min(1, "Title is required")
    .max(NOTE_TITLE_MAX_LENGTH, `Title must not exceed ${NOTE_TITLE_MAX_LENGTH} characters`)
    .describe("Note title"),
  content: z.string()
    .min(1, "Content is required")
    .max(NOTE_CONTENT_MAX_LENGTH, `Content must not exceed ${NOTE_CONTENT_MAX_LENGTH} characters`)
    .describe("Note content"),
  tags: z.array(z.string().max(NOTE_TAG_MAX_LENGTH))
    .max(NOTE_TAGS_MAX_COUNT, `Maximum ${NOTE_TAGS_MAX_COUNT} tags allowed`)
    .optional()
    .describe("Note tags"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type NoteAddParams = z.infer<typeof NoteAddSchema>;

export const NoteGetSchema = z.object({
  id: z.string().describe("Note ID"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type NoteGetParams = z.infer<typeof NoteGetSchema>;

// ============================================================================
// Meeting Schemas
// ============================================================================

export const MeetingsListSchema = z.object({
  status: z.enum(["recording", "uploading", "processing", "completed", "failed"])
    .optional()
    .describe("Filter by status"),
  search: z.string().optional().describe("Search term for titles"),
  from_date: z.string().datetime().optional().describe("Filter by start date (ISO 8601)"),
  to_date: z.string().datetime().optional().describe("Filter by end date (ISO 8601)"),
  ...PaginationSchema.shape
}).strict();

export type MeetingsListParams = z.infer<typeof MeetingsListSchema>;

export const MeetingGetSchema = z.object({
  id: z.string().describe("Meeting ID"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type MeetingGetParams = z.infer<typeof MeetingGetSchema>;

export const MeetingCreateSchema = z.object({
  title: z.string()
    .min(1, "Title is required")
    .max(MEETING_TITLE_MAX_LENGTH, `Title must not exceed ${MEETING_TITLE_MAX_LENGTH} characters`)
    .describe("Meeting title"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type MeetingCreateParams = z.infer<typeof MeetingCreateSchema>;

// ============================================================================
// Analytics Schemas
// ============================================================================

export const UsageStatsSchema = z.object({
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type UsageStatsParams = z.infer<typeof UsageStatsSchema>;

// ============================================================================
// Billing Schemas
// ============================================================================

export const PlansListSchema = z.object({
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type PlansListParams = z.infer<typeof PlansListSchema>;

export const InvoicesListSchema = z.object({
  status: z.enum(["paid", "pending", "failed"]).optional().describe("Filter by status"),
  from_date: z.string().datetime().optional().describe("Filter by start date (ISO 8601)"),
  to_date: z.string().datetime().optional().describe("Filter by end date (ISO 8601)"),
  ...PaginationSchema.shape
}).strict();

export type InvoicesListParams = z.infer<typeof InvoicesListSchema>;

export const InvoiceGetSchema = z.object({
  id: z.string().describe("Invoice ID"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type InvoiceGetParams = z.infer<typeof InvoiceGetSchema>;

export const SubscriptionGetSchema = z.object({
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type SubscriptionGetParams = z.infer<typeof SubscriptionGetSchema>;

// ============================================================================
// Memory / RAG Schemas
// ============================================================================

const MemoryTypeSchema = z
  .enum(["user", "knowledge", "hive"])
  .describe("Memory type: 'user' (personal), 'knowledge' (shared reference), 'hive' (workspace-wide)");

export const MemoryIngestSchema = z.object({
  text: z.string()
    .min(1, "Memory text cannot be empty")
    .max(100_000, "Memory text must not exceed 100,000 characters")
    .describe("The memory content to store"),
  title: z.string().optional().describe("Optional display title"),
  collection: z.string().optional()
    .describe("Collection ID to store in. Defaults to the caller's personal collection."),
  type: MemoryTypeSchema.default("user"),
  infer: z.boolean().default(true)
    .describe("If true, the memory service extracts structured facts via LLM inference"),
  metadata: z.record(z.unknown()).optional().describe("Arbitrary metadata key-value pairs"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemoryIngestParams = z.infer<typeof MemoryIngestSchema>;

export const MemoryIngestBatchSchema = z.object({
  memories: z.array(z.object({
    text: z.string().min(1).max(100_000),
    title: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    infer: z.boolean().optional(),
  })).min(1).max(100).describe("Array of memories to ingest (up to 100)"),
  collection: z.string().optional(),
  type: MemoryTypeSchema.default("knowledge"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemoryIngestBatchParams = z.infer<typeof MemoryIngestBatchSchema>;

export const MemoryUploadDocumentSchema = z.object({
  file_path: z.string().min(1)
    .describe("Absolute path to a document on the local filesystem (PDF, DOCX, XLSX, PPTX, EML, MSG, HTML, images, etc.)"),
  collection: z.string().optional(),
  type: MemoryTypeSchema.default("knowledge"),
  title: z.string().optional().describe("Display title; defaults to the filename"),
  chunk_size: z.number().int().min(200).max(8000).default(1500)
    .describe("Max characters per chunk"),
  chunk_overlap: z.number().int().min(0).max(2000).default(200)
    .describe("Character overlap between adjacent chunks"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemoryUploadDocumentParams = z.infer<typeof MemoryUploadDocumentSchema>;

export const MemorySearchSchema = z.object({
  query: z.string().min(1).max(2000).describe("Search query text"),
  collection: z.string().optional(),
  mode: z.enum(["fast", "thinking"]).default("fast"),
  max_results: z.number().int().min(1).max(50).default(10),
  alpha: z.number().min(0).max(1).default(0.8)
    .describe("Weight of semantic search: 0=keyword only, 1=semantic only"),
  recency_bias: z.number().min(0).max(1).default(0)
    .describe("Weight given to newer memories"),
  graph_context: z.boolean().default(false)
    .describe("Include knowledge-graph relationships in response"),
  // Advanced RAG per-request tuning knobs — override server defaults.
  rerank_top_k: z.number().int().min(1).max(500).optional()
    .describe("Max candidates the cross-encoder reranks (default: server setting)"),
  rerank_timeout_ms: z.number().int().min(50).max(5000).optional()
    .describe("Hard timeout for the rerank call in ms (default: server setting)"),
  min_rerank_score: z.number().min(0).max(1).optional()
    .describe("Drop results with rerank score below this threshold (default: server setting)"),
  fetch_multiplier: z.number().int().min(1).max(10).optional()
    .describe("In thinking mode, fetch N × max_results candidates before reranking (default: server setting)"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemorySearchParams = z.infer<typeof MemorySearchSchema>;

export const MemoryContextSchema = z.object({
  query: z.string().min(1).max(2000),
  session_id: z.string().optional()
    .describe("Chat session ID — enables hierarchical context assembly"),
  top_k: z.number().int().min(1).max(50).default(10),
  max_context_length: z.number().int().min(100).max(16_000).default(4000)
    .describe("Max tokens assembled in the returned prompt"),
  include_graph: z.boolean().default(false),
  include_timeline: z.boolean().default(true),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemoryContextParams = z.infer<typeof MemoryContextSchema>;

export const MemoryCollectionsListSchema = z.object({
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemoryCollectionsListParams = z.infer<typeof MemoryCollectionsListSchema>;

export const MemoryCollectionCreateSchema = z.object({
  collection_id: z.string().min(1).max(100)
    .describe("Unique ID for the collection (lowercase, alphanumeric + underscores)"),
  label: z.string().min(1).max(100).describe("Human-readable label"),
  kind: z.enum(["team", "knowledge", "hive"]).default("team")
    .describe("Collection kind — 'personal' is auto-created per user"),
  shared: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemoryCollectionCreateParams = z.infer<typeof MemoryCollectionCreateSchema>;

export const MemoryUsageSchema = z.object({
  period: z.enum(["current_month", "last_30_days", "all_time"])
    .default("current_month")
    .describe("Time window for the usage aggregation"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemoryUsageParams = z.infer<typeof MemoryUsageSchema>;

export const MemoryStatusSchema = z.object({
  id: z.string().min(1).describe("Memory ID returned from an ingest call"),
  collection: z.string().optional(),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemoryStatusParams = z.infer<typeof MemoryStatusSchema>;

export const MemoryDeleteSchema = z.object({
  id: z.string().min(1).describe("Memory ID to soft-delete (24h undo grace)"),
  collection: z.string().optional(),
  type: z.string().default("user"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MemoryDeleteParams = z.infer<typeof MemoryDeleteSchema>;

// ============================================================================
// Authz (Cerbos) Schemas
// ============================================================================

export const AuthzPermissionsSchema = z.object({
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AuthzPermissionsParams = z.infer<typeof AuthzPermissionsSchema>;

export const AuthzCheckSchema = z.object({
  resource: z.string().min(1)
    .describe("Resource kind (e.g. 'memory', 'voices', 'tts', 'workspace', 'billing')"),
  action: z.string().min(1)
    .describe("Action name (e.g. 'create', 'search', 'delete', 'billing:manage')"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AuthzCheckParams = z.infer<typeof AuthzCheckSchema>;

// ============================================================================
// Music (Song) Schemas
// ============================================================================

export const MusicCreateSongSchema = z.object({
  prompt: z.string()
    .min(1, "Prompt is required")
    .max(MUSIC_PROMPT_MAX_LENGTH, `Prompt must not exceed ${MUSIC_PROMPT_MAX_LENGTH} characters`)
    .describe("Simple mode: a free-text song description. Advanced mode: the style (genre, mood, instruments, BPM)."),
  mode: z.enum(["simple", "advanced"]).default("simple")
    .describe("'simple': lyrics are written for you from the prompt. 'advanced': you control style + lyrics source directly."),
  lyrics: z.string().max(MUSIC_LYRICS_MAX_LENGTH, `Lyrics must not exceed ${MUSIC_LYRICS_MAX_LENGTH} characters`)
    .optional()
    .describe("Your own lyrics; [Verse]/[Chorus] section tags allowed. Advanced mode only — mutually exclusive with lyrics_prompt."),
  lyrics_prompt: z.string().max(MUSIC_LYRICS_PROMPT_MAX_LENGTH, `Lyrics prompt must not exceed ${MUSIC_LYRICS_PROMPT_MAX_LENGTH} characters`)
    .optional()
    .describe("'Write lyrics for me' — the topic/idea. Advanced mode only — mutually exclusive with lyrics."),
  instrumental: z.boolean().default(false)
    .describe("If true, no lyrics source is needed — an [Instrumental] tag is sent automatically."),
  vocal_gender: z.enum(["Male", "Female"]).optional().describe("Preferred vocal gender"),
  voice_id: z.string().max(MUSIC_VOICE_ID_MAX_LENGTH).optional()
    .describe("A catalog voice ID or a saved voice ID owned by your workspace — see sixtydb_music_list_voices"),
  negative_tags: z.string().max(MUSIC_NEGATIVE_TAGS_MAX_LENGTH, `Negative tags must not exceed ${MUSIC_NEGATIVE_TAGS_MAX_LENGTH} characters`)
    .optional()
    .describe("Styles to exclude from generation"),
  target_duration: z.number().int()
    .min(MUSIC_TARGET_DURATION_MIN)
    .max(MUSIC_TARGET_DURATION_MAX)
    .optional()
    .describe(`Target duration in seconds (${MUSIC_TARGET_DURATION_MIN}-${MUSIC_TARGET_DURATION_MAX}) — treated as a hint by the model`),
  seed: z.string().regex(/^\d+$/, "Seed must be a digit string").max(MUSIC_SEED_MAX_LENGTH)
    .optional()
    .describe("Digit string (send as a string — it's 64-bit) for repeatable results"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MusicCreateSongParams = z.infer<typeof MusicCreateSongSchema>;

export const MusicGetSongSchema = z.object({
  song_id: z.string().min(1).describe("Song ID returned from sixtydb_music_create_song or sixtydb_music_list_songs"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MusicGetSongParams = z.infer<typeof MusicGetSongSchema>;

export const MusicListSongsSchema = z.object({
  q: z.string().optional().describe("Search over title, prompt and tags"),
  status: z.enum(["generating", "ready", "failed"]).optional().describe("Filter by processing status"),
  type: z.enum(["vocal", "instrumental"]).optional().describe("Filter by song type"),
  liked: z.boolean().optional().describe("Only liked songs"),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  ...PaginationSchema.shape
}).strict();
export type MusicListSongsParams = z.infer<typeof MusicListSongsSchema>;

export const MusicDownloadSongSchema = z.object({
  song_id: z.string().min(1).describe("Song ID to download"),
  output_path: z.string().optional()
    .describe("Absolute local filesystem path ending in .mp3 to save the audio to. If omitted, returns a fresh signed audio_url instead (never returns inline base64 audio)."),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MusicDownloadSongParams = z.infer<typeof MusicDownloadSongSchema>;

export const MusicListVoicesSchema = z.object({
  search: z.string().optional().describe("Case-insensitive filter over voice name (applied client-side)"),
  limit: z.number().int().min(1).max(MUSIC_LIST_VOICES_MAX_LIMIT).default(MUSIC_LIST_VOICES_DEFAULT_LIMIT)
    .describe("Max voices to return after filtering"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MusicListVoicesParams = z.infer<typeof MusicListVoicesSchema>;

export const MusicDeleteSongSchema = z.object({
  song_id: z.string().min(1).describe("Song ID to move to trash"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type MusicDeleteSongParams = z.infer<typeof MusicDeleteSongSchema>;

// ============================================================================
// Dialer Schemas
// ============================================================================

const E164Schema = z.string().regex(E164_REGEX, "Must be E.164 format, e.g. +14155551234");

export const DialerStatusSchema = z.object({
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerStatusParams = z.infer<typeof DialerStatusSchema>;

export const DialerSearchNumbersSchema = z.object({
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerSearchNumbersParams = z.infer<typeof DialerSearchNumbersSchema>;

export const DialerListNumbersSchema = z.object({
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerListNumbersParams = z.infer<typeof DialerListNumbersSchema>;

export const DialerBuyNumberSchema = z.object({
  number: E164Schema.optional().describe("Specific number to buy. Omit to buy the next available number from the shared pool."),
  assign_for: z.enum(["sip", "indian_number"]).optional()
    .describe("How the number will be used. 'sip' requires a finished trunk setup in the dashboard."),
  confirm: z.boolean().default(false)
    .describe("Must be true to actually purchase. Buying charges $6.00 immediately, then $6.00/month, and requires approved dialer KYC completed in the 60db app."),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerBuyNumberParams = z.infer<typeof DialerBuyNumberSchema>;

export const DialerReleaseNumberSchema = z.object({
  number: E164Schema.describe("The E.164 number to release"),
  confirm: z.boolean().default(false)
    .describe("Must be true to actually release. Releasing gives up the number and cancels its monthly rental — it cannot be undone."),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerReleaseNumberParams = z.infer<typeof DialerReleaseNumberSchema>;

export const DialerSetCallerIdSchema = z.object({
  caller_id: E164Schema.describe("An E.164 number you own to use as the default outbound caller ID"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerSetCallerIdParams = z.infer<typeof DialerSetCallerIdSchema>;

export const DialerListCallsSchema = z.object({
  limit: z.number().int().min(1).max(DIALER_LOGS_MAX_LIMIT).default(DIALER_LOGS_DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(0),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerListCallsParams = z.infer<typeof DialerListCallsSchema>;

export const DialerGetCallSchema = z.object({
  call_id: z.string().min(1).describe("Call ID from sixtydb_dialer_list_calls"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerGetCallParams = z.infer<typeof DialerGetCallSchema>;

export const DialerListRecordingsSchema = z.object({
  direction: z.enum(["inbound", "outbound"]).optional().describe("Filter by call direction"),
  status: z.string().optional().describe("Filter by recording status"),
  e164: E164Schema.optional().describe("Filter by associated phone number"),
  limit: z.number().int().min(1).max(DIALER_RECORDINGS_MAX_LIMIT).default(DIALER_RECORDINGS_DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(0),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerListRecordingsParams = z.infer<typeof DialerListRecordingsSchema>;

export const DialerGetRecordingUrlSchema = z.object({
  recording_id: z.string().min(1).describe("Recording ID"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerGetRecordingUrlParams = z.infer<typeof DialerGetRecordingUrlSchema>;

export const DialerGetRecordingTranscriptSchema = z.object({
  recording_id: z.string().min(1).describe("Recording ID"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerGetRecordingTranscriptParams = z.infer<typeof DialerGetRecordingTranscriptSchema>;

export const DialerGetUsageSchema = z.object({
  limit: z.number().int().min(1).max(DIALER_USAGE_MAX_LIMIT).default(DIALER_USAGE_DEFAULT_LIMIT)
    .describe("Max charge entries to return"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerGetUsageParams = z.infer<typeof DialerGetUsageSchema>;
