/**
 * Type definitions for QLabs MCP Server
 */

// Response format options
export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

// Voice types
export interface Voice {
  id: string;
  name: string;
  language?: string;
  dialect?: string;
  gender?: string;
  age?: string;
  is_public?: boolean;
  is_clone?: boolean;
  sample_audio_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProfessionalVoice {
  id: string;
  name: string;
  status: "processing" | "completed" | "failed";
  is_public: boolean;
  created_at: string;
}

// TTS types
export interface TTSRequest {
  text: string;
  voice_id: string;
  speed?: number;
  stability?: number;
  similarity?: number;
  output_format?: "mp3" | "wav" | "ogg";
}

export interface TTSResponse {
  id: string;
  audio_url: string;
  text: string;
  voice_id: string;
  duration?: number;
  credits_used: number;
  created_at: string;
}

export interface TTSLog {
  id: string;
  text: string;
  voice_id: string;
  voice_name: string;
  audio_url: string;
  duration: number;
  credits_used: number;
  created_at: string;
}

// STT types
export interface STTRequest {
  audio_file?: Buffer;
  audio_url?: string;
  language?: string;
  diarization?: boolean;
  punctuation?: boolean;
  timestamps?: boolean;
}

export interface STTResponse {
  id: string;
  text: string;
  language: string;
  duration: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  speakers?: Array<{
    speaker: string;
    start: number;
    end: number;
  }>;
  credits_used: number;
  created_at: string;
}

export interface STTLog {
  id: string;
  file_name: string;
  text: string;
  language: string;
  duration: number;
  credits_used: number;
  created_at: string;
}

// Workspace types
export interface Workspace {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  user_id: string;
  workspace_id: string;
  role: "owner" | "admin" | "developer" | "member" | "viewer";
  user?: {
    id: string;
    name: string;
    email: string;
  };
  joined_at: string;
}

// 60DB types
export interface HistoryEntry {
  id: string;
  text: string;
  app?: string;
  created_at: string;
  updated_at: string;
}

export interface DictionaryEntry {
  id: string;
  phrase: string;
  replacement: string;
  scope: "personal" | "team";
  voice_id?: string;
  created_at: string;
}

export interface Snippet {
  id: string;
  title: string;
  content: string;
  category?: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

// Meeting types
export interface Meeting {
  id: string;
  title: string;
  status: "recording" | "uploading" | "processing" | "completed" | "failed";
  duration?: number;
  transcript?: string;
  ai_notes?: string;
  ai_summary?: string;
  created_at: string;
  updated_at: string;
}

// Analytics types
export interface UsageStats {
  tts_credits_used: number;
  stt_credits_used: number;
  llm_credits_used: number;
  llm_cached_tokens?: number;
  total_credits_used: number;
  credits_remaining: number;
  period: {
    start: string;
    end: string;
  };
}

export interface VoiceAnalytics {
  voice_id: string;
  voice_name: string;
  total_generations: number;
  total_duration: number;
  avg_rating?: number;
}

// Billing types
export interface Plan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: "monthly" | "yearly";
  credits: number;
  features: string[];
}

export interface Subscription {
  id: string;
  plan_id: string;
  status: "active" | "cancelled" | "expired" | "past_due";
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

export interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: "paid" | "pending" | "failed";
  due_date: string;
  paid_at?: string;
  invoice_url: string;
}

// API Client types
export interface ApiClientConfig {
  baseURL: string;
  apiKey?: string;
  jwtToken?: string;
  timeout?: number;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

// Error types
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = "Authentication failed") {
    super(401, message);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends ApiError {
  constructor(public retryAfter?: number) {
    super(429, "Rate limit exceeded. Please wait before making more requests.");
    this.name = "RateLimitError";
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, public validationErrors?: Record<string, string>) {
    super(400, message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string) {
    super(404, `${resource} not found`);
    this.name = "NotFoundError";
  }
}
