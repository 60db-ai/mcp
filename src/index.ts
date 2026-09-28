#!/usr/bin/env node
/**
 * 60db MCP Server (stdio entry)
 *
 * Model Context Protocol server for the 60db platform.
 * Exposes tools for TTS, STT, voice cloning, meetings, workspaces,
 * billing, memory/RAG, authorization checks, AI music generation,
 * and dialer (SIP calling) management.
 *
 * For the hosted Streamable HTTP server (mcp.60db.ai) see http-server.ts.
 *
 * @package 60db-mcp-server
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getApiClient } from "./services/api-client.js";
import { DEFAULT_API_BASE_URL } from "./constants.js";
import { createSixtydbMcpServer } from "./create-sixtydb-mcp-server.js";

async function main() {
  // Env vars — prefer SIXTYDB_* but accept legacy QLABS_* for backward
  // compatibility with existing Claude Desktop configs.
  const apiBaseUrl =
    process.env.SIXTYDB_API_BASE_URL ||
    process.env.QLABS_API_BASE_URL ||
    DEFAULT_API_BASE_URL;
  const apiKey = process.env.SIXTYDB_API_KEY || process.env.QLABS_API_KEY;
  const jwtToken = process.env.SIXTYDB_JWT_TOKEN || process.env.QLABS_JWT_TOKEN;

  if (!apiKey && !jwtToken) {
    console.error("ERROR: SIXTYDB_API_KEY or SIXTYDB_JWT_TOKEN environment variable is required");
    console.error("");
    console.error("Set one of the following:");
    console.error("  export SIXTYDB_API_KEY=sk_your_api_key_here");
    console.error("  export SIXTYDB_JWT_TOKEN=your_jwt_token_here");
    console.error("");
    console.error(`Optional: Set API base URL (default: ${DEFAULT_API_BASE_URL})`);
    console.error("  export SIXTYDB_API_BASE_URL=https://api.60db.ai");
    console.error("");
    console.error("Legacy QLABS_* env vars are still honored for backward compatibility.");
    process.exit(1);
  }

  // Initialize the process-wide API client used by every tool in stdio mode
  getApiClient({
    baseURL: apiBaseUrl,
    apiKey: apiKey,
    jwtToken: jwtToken
  });

  const server = createSixtydbMcpServer();

  // Log to stderr (stdout is reserved for the MCP protocol)
  console.error("60db MCP Server starting...");
  console.error(`API URL: ${apiBaseUrl}`);
  console.error(`Auth: ${apiKey ? "API Key" : "JWT Token"}`);

  await server.connect(new StdioServerTransport());

  console.error("60db MCP Server running via stdio");
}

main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
