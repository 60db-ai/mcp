#!/usr/bin/env node
/**
 * 60db MCP Server
 *
 * Model Context Protocol server for the 60db platform.
 * Exposes tools for TTS, STT, voice cloning, meetings, workspaces,
 * billing, memory/RAG, authorization checks, AI music generation,
 * and dialer (SIP calling) management.
 *
 * @package 60db-mcp-server
 * @version 2.1.0
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getApiClient } from "./services/api-client.js";
import { DEFAULT_API_BASE_URL } from "./constants.js";

// Import tool registrations
import { registerVoiceTools } from "./tools/voices.js";
import { registerTTSTools } from "./tools/tts.js";
import { registerSTTTools } from "./tools/stt.js";
import { registerWorkspaceTools } from "./tools/workspaces.js";
import { register60DBTools } from "./tools/sixtydb.js";
import { registerMeetingAndAnalyticsTools } from "./tools/meetings.js";
import { registerBillingTools } from "./tools/billing.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerAuthzTools } from "./tools/authz.js";
import { registerMusicTools } from "./tools/music.js";
import { registerDialerTools } from "./tools/dialer.js";

/**
 * Main server initialization
 */
async function main() {
  // Env vars — prefer SIXTYDB_* but accept legacy QLABS_* for backward
  // compatibility with existing Claude Desktop configs.
  const apiBaseUrl =
    process.env.SIXTYDB_API_BASE_URL ||
    process.env.QLABS_API_BASE_URL ||
    DEFAULT_API_BASE_URL;
  const apiKey = process.env.SIXTYDB_API_KEY || process.env.QLABS_API_KEY;
  const jwtToken = process.env.SIXTYDB_JWT_TOKEN || process.env.QLABS_JWT_TOKEN;

  // Check for authentication
  if (!apiKey && !jwtToken) {
    console.error("ERROR: SIXTYDB_API_KEY or SIXTYDB_JWT_TOKEN environment variable is required");
    console.error("");
    console.error("Set one of the following:");
    console.error("  export SIXTYDB_API_KEY=sk_your_api_key_here");
    console.error("  export SIXTYDB_JWT_TOKEN=your_jwt_token_here");
    console.error("");
    console.error("Optional: Set API base URL (default: http://localhost:3000)");
    console.error("  export SIXTYDB_API_BASE_URL=https://api.60db.com");
    console.error("");
    console.error("Legacy QLABS_* env vars are still honored for backward compatibility.");
    process.exit(1);
  }

  // Initialize API client
  getApiClient({
    baseURL: apiBaseUrl,
    apiKey: apiKey,
    jwtToken: jwtToken
  });

  // Create MCP server instance
  const server = new McpServer({
    name: "60db-mcp-server",
    version: "2.1.0"
  });

  // Register all tools
  registerVoiceTools(server);
  registerTTSTools(server);
  registerSTTTools(server);
  registerWorkspaceTools(server);
  register60DBTools(server);
  registerMeetingAndAnalyticsTools(server);
  registerBillingTools(server);
  registerMemoryTools(server);
  registerAuthzTools(server);
  registerMusicTools(server);
  registerDialerTools(server);

  // Log to stderr (stdio is used for MCP protocol)
  console.error(`60db MCP Server starting...`);
  console.error(`API URL: ${apiBaseUrl}`);
  console.error(`Auth: ${apiKey ? "API Key" : "JWT Token"}`);

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);

  console.error("60db MCP Server running via stdio");
  console.error("");
  console.error("Available tool categories:");
  console.error("  - Voice Management: sixtydb_list_voices, sixtydb_get_voice, sixtydb_create_voice");
  console.error("  - Text-to-Speech: sixtydb_tts_synthesize, sixtydb_tts_logs, sixtydb_tts_get");
  console.error("  - Speech-to-Text: sixtydb_stt_transcribe, sixtydb_stt_logs, sixtydb_stt_get");
  console.error("  - Workspaces: sixtydb_list_workspaces, sixtydb_get_workspace, sixtydb_create_workspace, sixtydb_get_workspace_members");
  console.error("  - Productivity: sixtydb_60db_list_dictionary, sixtydb_60db_add_dictionary, sixtydb_60db_list_snippets, sixtydb_60db_add_snippet, sixtydb_60db_list_notes, sixtydb_60db_add_note, sixtydb_60db_get_note");
  console.error("  - Meetings: sixtydb_list_meetings, sixtydb_get_meeting, sixtydb_create_meeting");
  console.error("  - Analytics: sixtydb_get_usage_stats");
  console.error("  - Billing: sixtydb_list_invoices, sixtydb_get_invoice");
  console.error("  - Memory & RAG: sixtydb_memory_ingest, sixtydb_memory_ingest_batch, sixtydb_memory_upload_document, sixtydb_memory_search, sixtydb_memory_context, sixtydb_memory_list_collections, sixtydb_memory_create_collection, sixtydb_memory_get_usage, sixtydb_memory_get_status, sixtydb_memory_delete");
  console.error("  - Authorization: sixtydb_get_permissions, sixtydb_check_permission");
  console.error("  - Music: sixtydb_music_create_song, sixtydb_music_get_song, sixtydb_music_list_songs, sixtydb_music_download_song, sixtydb_music_list_voices, sixtydb_music_delete_song");
  console.error("  - Dialer: sixtydb_dialer_get_status, sixtydb_dialer_search_numbers, sixtydb_dialer_list_numbers, sixtydb_dialer_buy_number, sixtydb_dialer_release_number, sixtydb_dialer_set_caller_id, sixtydb_dialer_list_calls, sixtydb_dialer_get_call, sixtydb_dialer_list_recordings, sixtydb_dialer_get_recording_url, sixtydb_dialer_get_recording_transcript, sixtydb_dialer_get_usage");
  console.error("");
}

// Run the server
main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
