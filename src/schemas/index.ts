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
  DICTIONARY_PHRASE_MAX_LENGTH,
  DICTIONARY_REPLACEMENT_MAX_LENGTH,
  SNIPPET_TITLE_MAX_LENGTH,
  SNIPPET_CONTENT_MAX_LENGTH,
  SNIPPET_CATEGORY_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  NOTE_CONTENT_MAX_LENGTH,
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
  is_clone: z.boolean().optional().describe("true = only your cloned/professional voices, false = only the shared built-in catalog. Omit to see both."),
  search: z.string().optional().describe("Case-insensitive substring match on voice name (applied client-side — the API has no server-side search)"),
  ...PaginationSchema.shape
}).strict();

export type VoiceListParams = z.infer<typeof VoiceListSchema>;

export const VoiceGetSchema = z.object({
  id: z.string().describe("Voice ID (the `voice_id` returned by sixtydb_list_voices) to retrieve"),
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
  sample_audio_url: z.string().url().describe("Public URL to a sample audio recording (downloaded server-side and re-uploaded to the API — mp3/wav/m4a/flac/ogg, under 25MB (the API itself allows up to 200MB, but this tool caps the download at 25MB), 10-30s of clear speech recommended)"),
  language: z.string().optional().describe("Language code (e.g., 'en', 'hi')"),
  dialect: z.string().optional().describe("Dialect variant"),
  gender: z.string().optional().describe("Voice gender (e.g., 'male', 'female')"),
  description: z.string().optional().describe("Short description of the voice"),
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
  output_format: z.enum(["mp3", "wav", "ogg"]).optional().describe("Audio output format (default 'wav' — the only encoding confirmed supported by the backend; 'mp3'/'ogg' are passed through best-effort)"),
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
  id: z.string().describe("Workspace ID (numeric id or hash_id, as returned by sixtydb_list_workspaces)"),
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
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type DictionaryListParams = z.infer<typeof DictionaryListSchema>;

export const DictionaryAddSchema = z.object({
  term: z.string()
    .min(1, "Term is required")
    .max(DICTIONARY_PHRASE_MAX_LENGTH, `Term must not exceed ${DICTIONARY_PHRASE_MAX_LENGTH} characters`)
    .describe("Term/phrase to replace"),
  replacement: z.string()
    .min(1, "Replacement is required")
    .max(DICTIONARY_REPLACEMENT_MAX_LENGTH, `Replacement must not exceed ${DICTIONARY_REPLACEMENT_MAX_LENGTH} characters`)
    .describe("Replacement text"),
  tag: z.string().max(SNIPPET_CATEGORY_MAX_LENGTH).optional().describe("Optional label for the entry"),
  scope: z.enum(["personal", "team"]).default("personal").describe("Entry scope"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type DictionaryAddParams = z.infer<typeof DictionaryAddSchema>;

export const SnippetsListSchema = z.object({
  scope: z.enum(["personal", "team", "all"]).default("all").describe("Filter by scope"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
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
  tag: z.string()
    .max(SNIPPET_CATEGORY_MAX_LENGTH, `Tag must not exceed ${SNIPPET_CATEGORY_MAX_LENGTH} characters`)
    .optional()
    .describe("Snippet tag/category"),
  scope: z.enum(["personal", "team"]).default("personal").describe("Snippet scope"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
}).strict();

export type SnippetAddParams = z.infer<typeof SnippetAddSchema>;

export const NotesListSchema = z.object({
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
  tag: z.string()
    .max(NOTE_TAG_MAX_LENGTH, `Tag must not exceed ${NOTE_TAG_MAX_LENGTH} characters`)
    .optional()
    .describe("Optional single tag for the note"),
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
  status: z.enum(["recording", "processing", "completed"])
    .optional()
    .describe("Filter by status"),
  page: z.number().int().min(1).default(1).describe("Page number (1-based)"),
  limit: z.number().int().min(1).max(100).default(20).describe("Results per page (max 100)"),
  response_format: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
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
  platform: z.enum(["zoom", "google-meet", "teams", "webex", "slack", "manual"])
    .default("manual")
    .describe("Meeting platform"),
  start_time: z.string().datetime().optional()
    .describe("Meeting start time (ISO 8601). Defaults to now."),
  trigger_type: z.enum(["manual", "auto"]).default("manual").describe("How the meeting was started"),
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
  // The upstream song engine only accepts these targets (anything else fails validation).
  target_duration: z.union([z.literal(60), z.literal(120), z.literal(180)])
    .optional()
    .describe("Target length in seconds: exactly 60, 120 or 180 (the only values the engine accepts). Omit to let the model decide. Shorter clips aren't supported — generate 60 and trim."),
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

// ============================================================================
// Judge Schemas
// ============================================================================

/**
 * A rubric question. The three types ask genuinely different things, so the
 * shape of `criteria` changes with `type`:
 *   choice — a map of option name -> description (max 255)
 *   score  — an ordered ladder of level descriptions, lowest first (max 10)
 *   noul   — nothing required; optionally what true/false mean
 */
const JudgeEntrySchema = z.union([z.string(), z.record(z.any()), z.array(z.any()), z.null()]);

const JudgeChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: JudgeEntrySchema.optional().describe("The question being asked about the content"),
  criteria: z.record(JudgeEntrySchema)
    .describe("Option name -> description. ALWAYS include an 'unknown' option — without an escape hatch the model must pick a wrong label on off-topic content."),
});

const JudgeScoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: JudgeEntrySchema.optional(),
  criteria: z.array(JudgeEntrySchema).min(1).max(10)
    .describe("Ordered levels, LOWEST first. Max 10. The answer is a probability-weighted position on this ladder (e.g. 1.87), not an index."),
});

const JudgeNoulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: JudgeEntrySchema.optional(),
  criteria: z.object({ true: JudgeEntrySchema.optional(), false: JudgeEntrySchema.optional() })
    .nullable().optional().describe("Optional descriptions of what true and false mean"),
});

const JudgeQuestionSchema = z.union([
  JudgeChoiceQuestionSchema,
  JudgeScoreQuestionSchema,
  JudgeNoulQuestionSchema,
]);

/** z.record() has no .min()/.max(), so the 1..32 question limit is a refinement. */
const judgeQuestionCount = <T extends z.ZodTypeAny>(schema: T) =>
  schema.refine(
    (q: unknown) => {
      const n = Object.keys((q ?? {}) as Record<string, unknown>).length;
      return n >= 1 && n <= 32;
    },
    { message: "A rubric needs between 1 and 32 questions" },
  );

export const JudgeEvaluateSchema = z.object({
  state: z.union([z.string().min(1), z.record(z.any()), z.array(z.any())])
    .describe("The content every question is asked about — a transcript, ticket, document or any JSON. Each question sees this and nothing else."),
  questions: judgeQuestionCount(z.record(JudgeQuestionSchema)).optional()
    .describe("Map of answer key -> question. Max 32. Supply this OR rubric_id, never both."),
  rubric_id: z.string().uuid().optional()
    .describe("Run a saved rubric instead of inline questions — see sixtydb_judge_list_rubrics."),
  model: z.string().optional()
    .describe("Model name. Omit for the default; see sixtydb_judge_list_models for what this deployment serves."),
  save: z.boolean().default(true)
    .describe("false bills the run but keeps it out of history."),
  label: z.string().max(120).optional().describe("Tag for grouping runs in history"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type JudgeEvaluateParams = z.infer<typeof JudgeEvaluateSchema>;

const JudgeLabelMapSchema = z.record(z.string().min(1).max(256));

export const JudgeExtractSchema = z.object({
  text: z.string().min(1).max(2048)
    .describe("The conversational turn to classify. Max 2,048 Unicode code points."),
  schema: z.object({
    intents: JudgeLabelMapSchema.describe("Label -> description. What the speaker wants."),
    operations: JudgeLabelMapSchema.describe("Label -> description. What to do about it."),
    entities: JudgeLabelMapSchema.optional().describe("Label -> description. Values to pull out of the text."),
    responsePaths: JudgeLabelMapSchema.optional()
      .describe("Label -> description. How the agent should reply. Supplying this selects the v2 model."),
  }).describe("The label schema. Descriptions are what the model reads — vague descriptions give vague answers. The required 'unknown' label is added server-side if you omit it."),
  profile: z.enum(["generic", "medical"]).optional(),
  budget_ms: z.number().int().min(1).max(30000).optional()
    .describe("Total request budget in milliseconds"),
  save: z.boolean().default(true),
  label: z.string().max(120).optional(),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type JudgeExtractParams = z.infer<typeof JudgeExtractSchema>;

export const JudgeCreateRubricSchema = z.object({
  name: z.string().min(1).max(120).describe("Unique per workspace"),
  questions: judgeQuestionCount(z.record(JudgeQuestionSchema)),
  description: z.string().max(2000).optional(),
  model: z.string().optional(),
  shared: z.boolean().default(false)
    .describe("Publish to the whole workspace. Owner/admin only — a member gets 403."),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type JudgeCreateRubricParams = z.infer<typeof JudgeCreateRubricSchema>;

export const JudgeRubricIdSchema = z.object({
  rubric_id: z.string().uuid().describe("Rubric ID from sixtydb_judge_list_rubrics"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type JudgeRubricIdParams = z.infer<typeof JudgeRubricIdSchema>;

export const JudgeListRunsSchema = z.object({
  needs_review: z.boolean().default(false)
    .describe("Only runs the judge was under 85% sure about — the upstream's own escalation line, and the queue worth a human's attention."),
  kind: z.enum(["evaluate", "extract"]).optional(),
  rubric_id: z.string().uuid().optional().describe("Only runs of this rubric"),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type JudgeListRunsParams = z.infer<typeof JudgeListRunsSchema>;

export const JudgeRunIdSchema = z.object({
  run_id: z.string().uuid().describe("Run ID from sixtydb_judge_list_runs"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type JudgeRunIdParams = z.infer<typeof JudgeRunIdSchema>;

export const JudgeUsageSchema = z.object({
  period: z.enum(["current_month", "last_30_days", "all_time"]).default("current_month"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type JudgeUsageParams = z.infer<typeof JudgeUsageSchema>;

export const JudgeSimpleSchema = z.object({
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type JudgeSimpleParams = z.infer<typeof JudgeSimpleSchema>;
