/**
 * Zod Schemas for Input Validation
 */

import { z } from "zod";
import { ResponseFormat } from "../types/index.js";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_OFFSET,
  CALL_ANALYSIS_MAX_URLS_PER_CALL,
  CALL_ANALYSIS_MAX_LIMIT,
  CALL_ANALYSIS_DEFAULT_LIMIT,
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
  AGENT_NAME_MAX_LENGTH,
  AGENT_SCRIPT_MAX_LENGTH,
  AGENT_GREETING_MAX_LENGTH,
  AGENT_VOICE_ID_MAX_LENGTH,
  AGENT_MAX_LANGUAGES,
  AGENT_MAX_TOOLS,
  AGENT_TOOL_DESCRIPTION_MAX_LENGTH,
  AGENT_LIST_DEFAULT_LIMIT,
  AGENT_LIST_MAX_LIMIT,
  AGENT_CALL_STATUSES,
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

/** Read-only voice limit / professional voice tools take only an output format. */
export const VoiceReadOnlySchema = z.object({
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN).describe("Output format")
}).strict();

export type VoiceReadOnlyParams = z.infer<typeof VoiceReadOnlySchema>;

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
  audio_enhance: z.boolean().optional().describe("Polish the generated audio (default true). Set false to skip it for the fastest result"),
  model_id: z.string().optional().describe("Synthesis model (default '60db-quality-v01', matching the 60db app's own TTS requests). Override only for a voice that's known to need a different model, e.g. an Indic-language voice may need 'indic_tts_v1'."),
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
  cache: z.boolean().optional().describe(
    "Re-upload cache (server default: true). Byte-identical audio with the same options " +
    "from the same workspace within 30 days returns the stored transcript at the STT cached rate. " +
    "Pass false to opt out."
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

export const DialerGetBalanceSchema = z.object({
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type DialerGetBalanceParams = z.infer<typeof DialerGetBalanceSchema>;

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

// ============================================================================
// Agents Schemas
// ============================================================================

const AgentIdSchema = z.string().uuid().describe("Agent ID (UUID) from sixtydb_agents_list");
const AgentLanguagesSchema = z.array(z.string().regex(/^[a-z]{2,3}$/, "Lowercase 2-3 letter code, e.g. 'en', 'hi' (no dialect tags)"))
  .max(AGENT_MAX_LANGUAGES);

const AgentToolSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "Letters, digits, underscore; must not start with a digit")
    .refine((n) => n !== "transfer_call" && n !== "forget_me", "Reserved tool name"),
  description: z.string().min(1).max(AGENT_TOOL_DESCRIPTION_MAX_LENGTH),
  parameters: z.object({ type: z.literal("object") }).passthrough()
    .describe("JSON Schema for the tool arguments, type 'object', at most 4 KB of JSON")
}).strict();

const AgentCallSettingsShape = {
  speaks_first: z.enum(["agent", "caller"]).optional().describe("Who speaks first when the call connects"),
  start_delay_ms: z.number().int().min(0).max(10000).optional(),
  idle_ms: z.number().int().min(1000).max(60000).nullable().optional().describe("Silence before the agent checks in"),
  idle_checkins: z.number().int().min(0).max(5).optional(),
  max_duration_secs: z.number().int().min(10).max(900).optional().describe("Hard call length limit in seconds (10-900)"),
  record: z.boolean().optional().describe("Record the call (get recording consent where required by law)"),
  voice_speed: z.number().min(0.5).max(2).nullable().optional(),
  voice_stability: z.number().int().min(0).max(100).nullable().optional(),
  voice_similarity: z.number().int().min(0).max(100).nullable().optional(),
  speech_terms: z.array(z.string().min(1).max(80)).max(100).optional().describe("Words/names to recognize accurately"),
  dtmf: z.boolean().optional().describe("Keypad tones: the agent can press and collect keys"),
  latency_optimizer: z.boolean().optional().describe("Beta: the agent starts answering sooner, at a little more processing per reply")
};

const AgentSentimentsSchema = z.array(z.object({
  name: z.string().min(1).max(40).regex(/^[A-Za-z][A-Za-z0-9 _-]*$/).describe("Label word, starts with a letter, not 'unknown'"),
  description: z.string().max(200).optional().describe("What the label means, so the scorer can tell it apart")
}).strict()).max(10).describe("Call sentiment labels, e.g. hot/warm/cold. Empty = defaults positive/negative/neutral");

const AgentTransferTargetsSchema = z.array(z.object({
  name: z.string().min(1).max(40).regex(/^[A-Za-z][A-Za-z0-9 _-]*$/)
    .describe("Who the caller is put through to, e.g. 'Sales'. Becomes the agent's transfer_to_<name> function"),
  numbers: z.array(E164Schema).min(1).max(10).describe("E.164 numbers, tried in turn (up to 3 per transfer)")
}).strict()).max(10).describe("Call transfer destinations (max 10). [] turns call transfer off");

const AgentCallDefaultsSchema = z.object(AgentCallSettingsShape).strict();

const AgentWritableShape = {
  greeting: z.string().max(AGENT_GREETING_MAX_LENGTH).nullable().optional().describe("Opening line spoken when the call connects"),
  gender: z.enum(["female", "male"]).nullable().optional(),
  listen_languages: AgentLanguagesSchema.optional().describe("Languages the agent understands, e.g. ['en','hi']"),
  speak_languages: AgentLanguagesSchema.optional().describe("Languages the agent may speak"),
  emotion: z.boolean().optional().describe("Expressive speech (default true)"),
  tools: z.array(AgentToolSchema).max(AGENT_MAX_TOOLS).optional()
    .describe("Functions the agent can call mid-call; requires tool_webhook_url"),
  tool_webhook_url: z.string().url().max(2048).nullable().optional().describe("HTTPS endpoint that receives tool calls (required when tools are set)"),
  event_webhook_url: z.string().url().max(2048).nullable().optional().describe("HTTPS endpoint for call.completed / call.failed / recording.ready events"),
  knowledge_collection_id: z.string().uuid().nullable().optional().describe("Smart Memory workspace collection used as the agent's knowledge base"),
  sentiments: AgentSentimentsSchema.optional(),
  transfer_targets: AgentTransferTargetsSchema.optional(),
  call_defaults: AgentCallDefaultsSchema.optional().describe("Default per-call settings; overridable per call")
};

export const AgentsListSchema = z.object({
  limit: z.number().int().min(1).max(AGENT_LIST_MAX_LIMIT).default(AGENT_LIST_DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(DEFAULT_OFFSET),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsListParams = z.infer<typeof AgentsListSchema>;

export const AgentsGetSchema = z.object({
  agent_id: AgentIdSchema,
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsGetParams = z.infer<typeof AgentsGetSchema>;

export const AgentsCreateSchema = z.object({
  name: z.string().trim().min(1).max(AGENT_NAME_MAX_LENGTH).describe("Agent name, unique in the workspace"),
  script: z.string().min(1).max(AGENT_SCRIPT_MAX_LENGTH).describe("System prompt: who the agent is and how it handles the call"),
  voice_id: z.string().min(1).max(AGENT_VOICE_ID_MAX_LENGTH).describe("Voice ID (from the voices tools)"),
  ...AgentWritableShape,
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsCreateParams = z.infer<typeof AgentsCreateSchema>;

export const AgentsUpdateSchema = z.object({
  agent_id: AgentIdSchema,
  name: z.string().trim().min(1).max(AGENT_NAME_MAX_LENGTH).optional(),
  script: z.string().min(1).max(AGENT_SCRIPT_MAX_LENGTH).optional(),
  voice_id: z.string().min(1).max(AGENT_VOICE_ID_MAX_LENGTH).optional(),
  ...AgentWritableShape,
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsUpdateParams = z.infer<typeof AgentsUpdateSchema>;

export const AgentsDeleteSchema = z.object({
  agent_id: AgentIdSchema,
  confirm: z.boolean().default(false)
    .describe("Must be true to actually delete. Deleting detaches the agent from its phone lines and cannot be undone."),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsDeleteParams = z.infer<typeof AgentsDeleteSchema>;

export const AgentsPlaceCallSchema = z.object({
  agent_id: AgentIdSchema,
  to: E164Schema.describe("Phone number to call, E.164 e.g. +14155551234"),
  phone_line_id: z.string().uuid().describe("Phone line to call from (sixtydb_agents_list_phone_lines)"),
  overrides: AgentCallDefaultsSchema.extend({
    greeting: z.string().max(AGENT_GREETING_MAX_LENGTH).optional().describe("One-off greeting for this call"),
    sentiments: AgentSentimentsSchema.optional(),
    transfer_targets: AgentTransferTargetsSchema.optional()
  }).strict().optional().describe("Per-call overrides of the agent's call_defaults"),
  metadata: z.record(z.unknown()).optional().describe("Free-form JSON (max 4 KB) echoed back on the call and its events"),
  confirm: z.boolean().default(false)
    .describe("Must be true to actually place the call. This rings a real phone and spends AI credits and Dialer balance."),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsPlaceCallParams = z.infer<typeof AgentsPlaceCallSchema>;

export const AgentsStartStreamCallSchema = z.object({
  agent_id: AgentIdSchema,
  overrides: AgentCallDefaultsSchema.extend({
    greeting: z.string().max(AGENT_GREETING_MAX_LENGTH).optional().describe("One-off greeting for this call"),
    sentiments: AgentSentimentsSchema.optional(),
    transfer_targets: AgentTransferTargetsSchema.optional()
  }).strict().optional().describe("Per-call overrides of the agent's call_defaults"),
  metadata: z.record(z.unknown()).optional().describe("Free-form JSON (max 4 KB) echoed back on the call and its events"),
  confirm: z.boolean().default(false)
    .describe("Must be true to actually start the call. It spends AI credits once audio is streamed to the returned URL."),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsStartStreamCallParams = z.infer<typeof AgentsStartStreamCallSchema>;

export const AgentsListCallsSchema = z.object({
  agent_id: AgentIdSchema.optional(),
  status: z.enum(AGENT_CALL_STATUSES).optional(),
  direction: z.enum(["outbound", "inbound", "web", "stream"]).optional().describe("Filter by type: phone (outbound/inbound), browser (web) or WebSocket (stream)"),
  limit: z.number().int().min(1).max(AGENT_LIST_MAX_LIMIT).default(AGENT_LIST_DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(DEFAULT_OFFSET),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsListCallsParams = z.infer<typeof AgentsListCallsSchema>;

export const AgentsCallIdSchema = z.object({
  call_id: z.string().uuid().describe("Call ID from sixtydb_agents_place_call or sixtydb_agents_list_calls"),
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsCallIdParams = z.infer<typeof AgentsCallIdSchema>;

export const AgentsListPhoneLinesSchema = z.object({
  response_format: ResponseFormatSchema.default(ResponseFormat.MARKDOWN)
}).strict();
export type AgentsListPhoneLinesParams = z.infer<typeof AgentsListPhoneLinesSchema>;

// ─ Call analysis (analyzers) ───────────────────────────────

const CallAnalysisAgentIdSchema = z.string().uuid().describe("Analyzer ID (UUID) from sixtydb_call_analysis_list_analyzers");
const CallAnalysisCallIdSchema = z.string().uuid().describe("Call ID (UUID) from sixtydb_call_analysis_list_recordings (call_id)");
const CallAnalysisFormat = ResponseFormatSchema.default(ResponseFormat.MARKDOWN);
const CallAnalysisDaysSchema = z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30)
  .describe("Look-back window in days: 7, 30 or 90");

const CallAnalysisWritableShape = {
  name: z.string().trim().min(1).max(120).describe("Analyzer name"),
  instructions: z.string().trim().min(1).max(20000).describe("What to check for in each call (the analysis brief)"),
  description: z.string().max(1000).nullable().optional().describe("Short description"),
  knowledge_collection_id: z.string().uuid().nullable().optional().describe("Knowledge collection to ground the analysis (must be visible to the workspace owner)"),
  key_terms: z.array(z.string().min(1).max(60)).max(200).optional().describe("Domain terms to help transcription"),
  language: z.string().max(20).nullable().optional().describe("Call language, e.g. en"),
};

export const CallAnalysisListAnalyzersSchema = z.object({
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisListAnalyzersParams = z.infer<typeof CallAnalysisListAnalyzersSchema>;

export const CallAnalysisCreateAnalyzerSchema = z.object({
  ...CallAnalysisWritableShape,
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisCreateAnalyzerParams = z.infer<typeof CallAnalysisCreateAnalyzerSchema>;

export const CallAnalysisGetAnalyzerSchema = z.object({
  agent_id: CallAnalysisAgentIdSchema,
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisGetAnalyzerParams = z.infer<typeof CallAnalysisGetAnalyzerSchema>;

export const CallAnalysisUpdateAnalyzerSchema = z.object({
  agent_id: CallAnalysisAgentIdSchema,
  name: CallAnalysisWritableShape.name.optional(),
  instructions: CallAnalysisWritableShape.instructions.optional(),
  description: CallAnalysisWritableShape.description,
  knowledge_collection_id: CallAnalysisWritableShape.knowledge_collection_id,
  key_terms: CallAnalysisWritableShape.key_terms,
  language: CallAnalysisWritableShape.language,
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisUpdateAnalyzerParams = z.infer<typeof CallAnalysisUpdateAnalyzerSchema>;

export const CallAnalysisArchiveAnalyzerSchema = z.object({
  agent_id: CallAnalysisAgentIdSchema,
  confirm: z.boolean().default(false)
    .describe("Must be true to actually archive. The analyzer stops watching call agents; calls and recordings are kept."),
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisArchiveAnalyzerParams = z.infer<typeof CallAnalysisArchiveAnalyzerSchema>;

export const CallAnalysisAddRecordingUrlsSchema = z.object({
  agent_id: CallAnalysisAgentIdSchema,
  urls: z.array(z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), "Only http(s) URLs"))
    .min(1).max(CALL_ANALYSIS_MAX_URLS_PER_CALL)
    .describe(`Public http(s) URLs of call recordings (audio/mpeg, wav, m4a, mp4, ogg, flac, webm; max 100 MiB each). 1-${CALL_ANALYSIS_MAX_URLS_PER_CALL} per call.`),
  name: z.string().trim().min(1).max(200).optional().describe("Batch label"),
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisAddRecordingUrlsParams = z.infer<typeof CallAnalysisAddRecordingUrlsSchema>;

export const CallAnalysisAnalyzeSchema = z.object({
  agent_id: CallAnalysisAgentIdSchema,
  confirm_count: z.number().int().min(0).optional()
    .describe("Number of ready recordings you agree to analyze (shown by the preview). Omit to only preview; analysis spends credits."),
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisAnalyzeParams = z.infer<typeof CallAnalysisAnalyzeSchema>;

export const CallAnalysisListRecordingsSchema = z.object({
  agent_id: CallAnalysisAgentIdSchema,
  status: z.enum(["uploading", "ready", "waiting", "transcribing", "analyzing", "done", "failed", "cancelled"]).optional(),
  category: z.enum(["wrong_information", "missed_step", "compliance", "customer_unresolved", "behaviour", "other"]).optional(),
  severity: z.enum(["high", "medium", "low"]).optional(),
  q: z.string().max(200).optional().describe("Search title / person"),
  limit: z.number().int().min(1).max(CALL_ANALYSIS_MAX_LIMIT).default(CALL_ANALYSIS_DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(DEFAULT_OFFSET),
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisListRecordingsParams = z.infer<typeof CallAnalysisListRecordingsSchema>;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, "ISO date, e.g. 2026-11-01");

export const CallAnalysisGetProblemsSchema = z.object({
  agent_id: CallAnalysisAgentIdSchema,
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisGetProblemsParams = z.infer<typeof CallAnalysisGetProblemsSchema>;

export const CallAnalysisGetAnalyticsSchema = z.object({
  agent_id: CallAnalysisAgentIdSchema.optional()
    .describe("Analyzer ID. Omit for the workspace-wide overview across all analyzers."),
  days: CallAnalysisDaysSchema,
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisGetAnalyticsParams = z.infer<typeof CallAnalysisGetAnalyticsSchema>;

export const CallAnalysisGetCallAnalysisSchema = z.object({
  call_id: CallAnalysisCallIdSchema,
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisGetCallAnalysisParams = z.infer<typeof CallAnalysisGetCallAnalysisSchema>;

export const CallAnalysisSuggestAgentFixSchema = z.object({
  call_id: CallAnalysisCallIdSchema,
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisSuggestAgentFixParams = z.infer<typeof CallAnalysisSuggestAgentFixSchema>;

export const CallAnalysisApplyAgentFixSchema = z.object({
  call_id: CallAnalysisCallIdSchema,
  base_hash: z.string().regex(/^[0-9a-f]{64}$/i, "64 hex characters").describe("base_hash returned by sixtydb_call_analysis_suggest_agent_fix"),
  script: z.string().min(1).max(AGENT_SCRIPT_MAX_LENGTH).describe("The new agent script to save (normally the suggestion's `after`, optionally edited)"),
  confirm: z.boolean().default(false).describe("Must be true to overwrite the agent's script. The previous script is kept and can be restored with undo."),
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisApplyAgentFixParams = z.infer<typeof CallAnalysisApplyAgentFixSchema>;

export const CallAnalysisUndoAgentFixSchema = z.object({
  call_id: CallAnalysisCallIdSchema,
  fix_id: z.string().uuid().describe("fix_id returned by sixtydb_call_analysis_apply_agent_fix"),
  confirm: z.boolean().default(false).describe("Must be true to restore the previous agent script."),
  response_format: CallAnalysisFormat
}).strict();
export type CallAnalysisUndoAgentFixParams = z.infer<typeof CallAnalysisUndoAgentFixSchema>;
