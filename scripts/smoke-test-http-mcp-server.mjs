#!/usr/bin/env node
/**
 * Smoke test for the hosted MCP endpoint using the official MCP SDK client.
 *
 *   MCP_URL=https://mcp.60db.ai/mcp SIXTYDB_API_KEY=sk_live_... node scripts/smoke-test-http-mcp-server.mjs
 *
 * Checks: 401 challenge without a token, initialize + tools/list, and one
 * read-only tool call (sixtydb_get_permissions) with the given key.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpUrl = process.env.MCP_URL || "http://localhost:8787/mcp";
const apiKey = process.env.SIXTYDB_API_KEY;

if (!apiKey) {
  console.error("SIXTYDB_API_KEY is required");
  process.exit(1);
}

async function checkUnauthorizedChallenge() {
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  const challenge = res.headers.get("www-authenticate") || "";
  if (res.status !== 401 || !challenge.includes("resource_metadata=")) {
    throw new Error(`Expected 401 with resource_metadata challenge, got ${res.status} "${challenge}"`);
  }
  console.log("✔ 401 + WWW-Authenticate challenge without token");
}

async function checkToolsWithKey() {
  const client = new Client({ name: "60db-smoke-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } }
  });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const destructive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
  console.log(`✔ tools/list returned ${tools.length} tools (destructive: ${destructive.join(", ") || "none"})`);

  // Hosted mode must never expose tools that read the server's filesystem.
  if (tools.some((t) => t.name === "sixtydb_memory_upload_document")) {
    throw new Error("sixtydb_memory_upload_document must not be exposed on the hosted server");
  }
  console.log("✔ local-filesystem tool (sixtydb_memory_upload_document) not exposed");

  const result = await client.callTool({ name: "sixtydb_get_permissions", arguments: {} });
  if (result.isError) throw new Error(`Tool call failed: ${JSON.stringify(result.content)}`);
  console.log(`✔ sixtydb_get_permissions: ${JSON.stringify(result.content).slice(0, 200)}`);

  await client.close();
}

try {
  await checkUnauthorizedChallenge();
  await checkToolsWithKey();
  console.log(`All checks passed for ${mcpUrl}`);
} catch (error) {
  console.error(`✘ ${error.message}`);
  process.exit(1);
}
