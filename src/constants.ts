/**
 * Constants for QLabs MCP Server
 */

// API Configuration
export const DEFAULT_API_BASE_URL = "http://localhost:3000";
export const API_TIMEOUT = 30000; // 30 seconds
export const CHARACTER_LIMIT = 25000; // Maximum response size in characters

// Pagination Defaults
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const DEFAULT_OFFSET = 0;

// TTS Limits
export const TTS_MAX_TEXT_LENGTH = 5000;
export const TTS_DEFAULT_SPEED = 1.0;
export const TTS_MIN_SPEED = 0.25;
export const TTS_MAX_SPEED = 2.0;
export const TTS_DEFAULT_STABILITY = 50;
export const TTS_MIN_STABILITY = 0;
export const TTS_MAX_STABILITY = 100;
export const TTS_DEFAULT_SIMILARITY = 75;
export const TTS_MIN_SIMILARITY = 0;
export const TTS_MAX_SIMILARITY = 100;

// STT Limits
export const STT_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
export const STT_SUPPORTED_FORMATS = ["mp3", "wav", "m4a", "ogg", "flac"];
export const STT_BATCH_MAX_FILES = 10;

// Voice Limits
export const VOICE_NAME_MIN_LENGTH = 1;
export const VOICE_NAME_MAX_LENGTH = 100;
export const VOICE_SAMPLE_REQUIRED = true;

// Workspace Limits
export const WORKSPACE_NAME_MIN_LENGTH = 1;
export const WORKSPACE_NAME_MAX_LENGTH = 100;
export const WORKSPACE_DESC_MAX_LENGTH = 500;

// Dictionary Limits
export const DICTIONARY_PHRASE_MAX_LENGTH = 200;
export const DICTIONARY_REPLACEMENT_MAX_LENGTH = 200;

// Snippet Limits
export const SNIPPET_TITLE_MAX_LENGTH = 100;
export const SNIPPET_CONTENT_MAX_LENGTH = 10000;
export const SNIPPET_CATEGORY_MAX_LENGTH = 50;

// Note Limits
export const NOTE_TITLE_MAX_LENGTH = 200;
export const NOTE_CONTENT_MAX_LENGTH = 50000;
export const NOTE_TAGS_MAX_COUNT = 10;
export const NOTE_TAG_MAX_LENGTH = 50;

// Meeting Limits
export const MEETING_TITLE_MAX_LENGTH = 200;
export const MEETING_MAX_DURATION = 8 * 60 * 60 * 1000; // 8 hours in ms

// LLM Limits
export const LLM_MAX_TOKENS = 128000;
export const LLM_DEFAULT_MAX_TOKENS = 4096;
export const LLM_DEFAULT_TEMPERATURE = 0.7;

// Rate Limits
export const RATE_LIMIT_MAX_REQUESTS = 100;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// API Response Codes
export const API_CODES = {
  SUCCESS: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMIT: 429,
  SERVER_ERROR: 500
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  AUTH_REQUIRED: "Authentication required. Please provide API key or JWT token.",
  INVALID_CREDENTIALS: "Invalid credentials provided.",
  RATE_LIMIT: "Rate limit exceeded. Please wait before making more requests.",
  NOT_FOUND: (resource: string) => `${resource} not found. Please check the ID is correct.`,
  VALIDATION_ERROR: "Input validation failed. Please check your parameters.",
  SERVER_ERROR: "Internal server error. Please try again later.",
  TIMEOUT: "Request timed out. Please try again.",
  NETWORK_ERROR: "Network error. Please check your connection."
} as const;

// Supported Languages
export const SUPPORTED_LANGUAGES = [
  { code: "en-US", name: "English (US)" },
  { code: "en-GB", name: "English (UK)" },
  { code: "es-ES", name: "Spanish (Spain)" },
  { code: "es-MX", name: "Spanish (Mexico)" },
  { code: "fr-FR", name: "French" },
  { code: "de-DE", name: "German" },
  { code: "it-IT", name: "Italian" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "pt-PT", name: "Portuguese (Portugal)" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "ja-JP", name: "Japanese" },
  { code: "ko-KR", name: "Korean" },
  { code: "ru-RU", name: "Russian" },
  { code: "ar-SA", name: "Arabic" },
  { code: "hi-IN", name: "Hindi" }
] as const;

// Voice Genders
export const VOICE_GENDERS = ["male", "female", "neutral"] as const;

// Voice Age Ranges
export const VOICE_AGES = ["young", "middle", "old"] as const;

// Workspace Roles
export const WORKSPACE_ROLES = ["owner", "admin", "developer", "member", "viewer"] as const;

// Dictionary Scopes
export const DICTIONARY_SCOPES = ["personal", "team"] as const;

// Meeting Statuses
export const MEETING_STATUSES = ["recording", "uploading", "processing", "completed", "failed"] as const;

// Subscription Statuses
export const SUBSCRIPTION_STATUSES = ["active", "cancelled", "expired", "past_due"] as const;

// Invoice Statuses
export const INVOICE_STATUSES = ["paid", "pending", "failed"] as const;

// Output Formats
export const TTS_OUTPUT_FORMATS = ["mp3", "wav", "ogg"] as const;

// Music (Song) Limits
export const MUSIC_PROMPT_MAX_LENGTH = 2000;
export const MUSIC_LYRICS_MAX_LENGTH = 12000;
export const MUSIC_LYRICS_PROMPT_MAX_LENGTH = 2000;
export const MUSIC_NEGATIVE_TAGS_MAX_LENGTH = 1000;
export const MUSIC_VOICE_ID_MAX_LENGTH = 100;
export const MUSIC_TARGET_DURATION_MIN = 10;
export const MUSIC_TARGET_DURATION_MAX = 600;
export const MUSIC_SEED_MAX_LENGTH = 19;
export const MUSIC_LIST_VOICES_DEFAULT_LIMIT = 50;
export const MUSIC_LIST_VOICES_MAX_LIMIT = 200;

// Dialer Limits
export const E164_REGEX = /^\+[1-9]\d{1,14}$/;
export const DIALER_LOGS_MAX_LIMIT = 200;
export const DIALER_LOGS_DEFAULT_LIMIT = 50;
export const DIALER_RECORDINGS_MAX_LIMIT = 200;
export const DIALER_RECORDINGS_DEFAULT_LIMIT = 25;
export const DIALER_USAGE_MAX_LIMIT = 200;
export const DIALER_USAGE_DEFAULT_LIMIT = 50;
