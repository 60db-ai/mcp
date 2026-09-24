# 60db-mcp Server

Model Context Protocol (MCP) server for the 60db Voice AI Platform. This server exposes comprehensive tools for text-to-speech, speech-to-text, voice cloning, meeting management, workspace collaboration, and billing operations.

## Features

- **Voice Management**: List, retrieve, and create cloned voices
- **Text-to-Speech (TTS)**: Synthesize speech with custom voices, speed, stability, and similarity
- **Speech-to-Text (STT)**: Transcribe audio with speaker diarization and timestamps
- **Workspace Management**: Create and manage team workspaces
- **60DB Integration**: Dictionary, snippets, and notes for enhanced transcriptions
- **Meeting Management**: Record meetings with AI-generated notes and summaries
- **Analytics**: Track usage statistics and credit consumption
- **Billing**: View plans, subscriptions, and invoices
- **Music**: Generate AI songs from a prompt or lyrics, poll status, download MP3s, browse voices
- **Dialer**: Manage SIP phone numbers, caller ID, call history, recordings, and billing usage

## Installation

```bash
npm install
npm run build
```

## Configuration

Set required environment variables:

```bash
# Authentication (required - one of these)
export X60DB_API_KEY=sk_your_api_key_here
# OR
export X60DB_JWT_TOKEN=your_jwt_token_here

# Optional: API base URL (default: http://localhost:3000)
export X60DB_API_BASE_URL=https://api.60db.ai
```

## Usage

### Start the Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

### Available Tools

#### Voice Management
- `60db_list_voices` - List available voices with filtering
- `60db_get_voice` - Get detailed voice information
- `60db_create_voice` - Create a cloned voice

#### Text-to-Speech
- `60db_tts_synthesize` - Convert text to speech
- `60db_tts_logs` - Get TTS generation history
- `60db_tts_get` - Get TTS generation details

#### Speech-to-Text
- `60db_stt_transcribe` - Transcribe audio to text
- `60db_stt_logs` - Get transcription history
- `60db_stt_get` - Get transcription details

#### Workspace Management
- `60db_list_workspaces` - List all workspaces
- `60db_get_workspace` - Get workspace details
- `60db_create_workspace` - Create a new workspace
- `60db_get_workspace_members` - List workspace members

#### 60DB Tools
- `60db_60db_list_dictionary` - List pronunciation dictionary entries
- `60db_60db_add_dictionary` - Add dictionary entry
- `60db_60db_list_snippets` - List text snippets
- `60db_60db_add_snippet` - Add text snippet
- `60db_60db_list_notes` - List personal notes
- `60db_60db_add_note` - Add personal note
- `60db_60db_get_note` - Get note details

#### Meeting Management
- `60db_list_meetings` - List meetings
- `60db_get_meeting` - Get meeting details
- `60db_create_meeting` - Create new meeting

#### Analytics
- `60db_get_usage_stats` - Get usage statistics

#### Billing
- `60db_list_plans` - List available subscription plans
- `60db_get_subscription` - Get current subscription details
- `60db_list_invoices` - List billing invoices
- `60db_get_invoice` - Get invoice details

#### Music
- `sixtydb_music_create_song` - Generate a song from a prompt (simple mode) or full lyrics control (advanced mode); async, free during beta
- `sixtydb_music_get_song` - Poll a song's status; returns lyrics + signed audio URL once ready
- `sixtydb_music_list_songs` - List songs with search/status/type/liked filters
- `sixtydb_music_download_song` - Save a finished song's MP3 to a local path, or get a fresh audio URL
- `sixtydb_music_list_voices` - Browse catalog + saved voices usable for vocals
- `sixtydb_music_delete_song` - Move a song to trash

#### Dialer
- `sixtydb_dialer_get_status` - Get account provisioning status
- `sixtydb_dialer_search_numbers` - Search numbers available to buy
- `sixtydb_dialer_list_numbers` - List numbers your workspace owns
- `sixtydb_dialer_buy_number` - Buy a number (requires `confirm: true`; charges $6.00 now + $6.00/month; requires approved Dialer KYC completed in the 60db app — Dialer → KYC, not via API)
- `sixtydb_dialer_release_number` - Release a number (requires `confirm: true`; irreversible)
- `sixtydb_dialer_set_caller_id` - Set the default outbound caller ID
- `sixtydb_dialer_list_calls` - List call history
- `sixtydb_dialer_get_call` - Get a single call's detail
- `sixtydb_dialer_list_recordings` - List call recordings
- `sixtydb_dialer_get_recording_url` - Get a short-lived (~5 min) recording playback URL
- `sixtydb_dialer_get_recording_transcript` - Get (or generate) a recording transcript
- `sixtydb_dialer_get_usage` - Combined billing usage + active number subscriptions

## Response Formats

All tools support two response formats:

- **markdown** (default): Human-readable formatted output
- **json**: Machine-readable structured data

Example:
```json
{
  "voice_id": "voice_abc123",
  "text": "Hello, world!",
  "response_format": "json"
}
```

## Pagination

List tools support pagination:

- `limit`: Maximum results (1-100, default: 20)
- `offset`: Number of results to skip (default: 0)

Example:
```json
{
  "limit": 50,
  "offset": 0
}
```

## Examples

### List Voices

```json
{
  "language": "en-US",
  "is_public": true,
  "limit": 10
}
```

### Synthesize Speech

```json
{
  "text": "Hello, this is a test.",
  "voice_id": "voice_abc123",
  "speed": 1.0,
  "output_format": "mp3"
}
```

### Transcribe Audio

```json
{
  "audio_url": "https://example.com/audio.mp3",
  "language": "en-US",
  "diarization": true,
  "punctuation": true
}
```

### Get Usage Statistics

```json
{
  "response_format": "markdown"
}
```

## Character Limits

Responses are automatically truncated at 25,000 characters to prevent overwhelming output. Truncated responses include a message with guidance on pagination.

## Error Handling

All tools return clear, actionable error messages:

- `Error: Authentication required` - Invalid or missing credentials
- `Error: Rate limit exceeded` - Too many requests (429 status)
- `Error: Resource not found` - Invalid ID (404 status)
- `Error: Insufficient credits` - Not enough credits for operation

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run type checking
npm run type-check
```

## Project Structure

```
60db-mcp-server/
├── src/
│   ├── index.ts           # Main entry point
│   ├── constants.ts       # Configuration constants
│   ├── types/            # TypeScript type definitions
│   ├── schemas/          # Zod validation schemas
│   ├── services/         # API client and formatters
│   └── tools/            # Tool implementations
│       ├── voices.ts
│       ├── tts.ts
│       ├── stt.ts
│       ├── workspaces.ts
│       ├── sixtydb.ts
│       ├── meetings.ts
│       └── billing.ts
├── dist/                 # Built JavaScript files
├── package.json
├── tsconfig.json
└── README.md
```

## Testing with MCP Inspector

```bash
# Install MCP Inspector
npm install -g @modelcontextprotocol/inspector

# Run inspector
mcp-inspector node dist/index.js
```

## Claude Desktop Integration

Add to Claude Desktop configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "60db-mcp": {
      "command": "node",
      "args": ["/path/to/60db-mcp-server/dist/index.js"],
      "env": {
        "X60DB_API_KEY": "sk_your_api_key_here",
        "X60DB_API_BASE_URL": "https://api.60db.ai"
      }
    }
  }
}
```

## License

MIT

## Support

For issues and questions, please contact 60db support or visit the documentation at https://docs.60db.ai
