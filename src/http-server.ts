#!/usr/bin/env node
/**
 * 60db MCP Server — hosted Streamable HTTP entry (https://mcp.60db.ai/mcp)
 *
 * Stateless: every POST /mcp builds a fresh McpServer + transport bound to the
 * caller's Bearer token, so instances scale horizontally with no session store.
 */

import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { QLabsApiClient } from "./services/api-client.js";
import { runWithApiClient } from "./services/request-context.js";
import { createSixtydbMcpServer } from "./create-sixtydb-mcp-server.js";
import {
  extractBearerToken,
  hashToken,
  isRecentlyVerifiedToken,
  requireBearerAuth
} from "./http-auth-middleware.js";
import { DEFAULT_API_BASE_URL, SERVER_VERSION } from "./constants.js";
import { setupMcpOAuth } from "./oauth/setup-mcp-oauth.js";

// Server-only secrets (MCP_OAUTH_SECRET, GOOGLE_CLIENT_ID) live in an uncommitted .env.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: rely on the process environment
}

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const API_BASE_URL = (process.env.SIXTYDB_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");
const PUBLIC_MCP_URL = process.env.PUBLIC_MCP_URL || "https://mcp.60db.ai/mcp";
const PUBLIC_ORIGIN = new URL(PUBLIC_MCP_URL).origin;
// OAuth sign-in (Claude.ai / ChatGPT connectors) is enabled when a sealing secret is set.
const OAUTH_SECRET = process.env.MCP_OAUTH_SECRET || "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || undefined;
const LANDING_PAGE_URL = "https://60db.ai/mcp";
const RESOURCE_METADATA_URL = `${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp`;

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // behind nginx

// CORS for browser-based MCP clients (e.g. MCP Inspector).
app.use((req: Request, res: Response, next: NextFunction) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate"
  });
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/", (_req, res) => res.redirect(302, LANDING_PAGE_URL));
app.get("/health", (_req, res) => res.json({ status: "ok", version: SERVER_VERSION }));

// OAuth 2.1 sign-in for Claude.ai / ChatGPT connectors (see oauth/setup-mcp-oauth.ts).
const oauth = OAUTH_SECRET
  ? setupMcpOAuth(app, {
      secret: OAUTH_SECRET,
      publicOrigin: PUBLIC_ORIGIN,
      publicMcpUrl: PUBLIC_MCP_URL,
      apiBaseUrl: API_BASE_URL,
      documentationUrl: LANDING_PAGE_URL,
      googleClientId: GOOGLE_CLIENT_ID
    })
  : undefined;

/** Bearer → 60db API key: raw sk_ keys pass through, OAuth tokens are unsealed. */
const resolveOAuthToken = oauth?.resolveApiKey;
const bearerApiKey = (req: Request): string | undefined => {
  const bearer = extractBearerToken(req);
  return bearer && !bearer.startsWith("sk_") ? resolveOAuthToken?.(bearer) : bearer;
};

// RFC 9728 protected resource metadata (root form; the SDK router serves /mcp suffix when OAuth is on).
const protectedResourceMetadata = (_req: Request, res: Response) => {
  res.json({
    resource: PUBLIC_MCP_URL,
    authorization_servers: oauth ? [oauth.issuer] : [],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_name: "60db",
    resource_documentation: LANDING_PAGE_URL
  });
};
app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);

const rateLimitMessage = { jsonrpc: "2.0", error: { code: -32029, message: "Rate limit exceeded" }, id: null };

// Pre-auth, per IP, counting only FAILED requests: throttles token guessing (each
// unknown token costs an API round-trip) without penalising shared egress IPs such
// as Claude.ai / ChatGPT, whose successful traffic is never counted here.
const failedAuthLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.MCP_FAILED_AUTH_PER_MIN || 30),
  skipSuccessfulRequests: true,
  // Verified tokens cost nothing to check, so they are never blocked by others' failures.
  skip: (req) => isRecentlyVerifiedToken(bearerApiKey(req)),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || "unknown"),
  message: rateLimitMessage
});

// Post-auth, per verified token. In-memory buckets are per pm2 worker.
const perTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.MCP_RATE_LIMIT_PER_MIN || 120),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (_req, res) => hashToken(res.locals.bearerToken),
  message: rateLimitMessage
});

/** Caller-controlled strings are truncated and stripped before logging. */
const safeLogValue = (value: unknown): string =>
  typeof value === "string" ? value.replace(/[^\w./:-]/g, "").slice(0, 64) : "";

app.post(
  "/mcp",
  failedAuthLimiter,
  requireBearerAuth({ apiBaseUrl: API_BASE_URL, resourceMetadataUrl: RESOURCE_METADATA_URL, resolveOAuthToken }),
  perTokenLimiter,
  express.json({ limit: "2mb" }), // parse only after the caller is authenticated
  async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const apiClient = new QLabsApiClient({ baseURL: API_BASE_URL, apiKey: res.locals.bearerToken });
    const server = createSixtydbMcpServer({ hosted: true });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
      enableJsonResponse: true
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
      const method = safeLogValue(req.body?.method) || "batch";
      const toolName = safeLogValue(req.body?.params?.name);
      const tool = toolName ? ` ${toolName}` : "";
      console.log(`[mcp] ${method}${tool} -> ${res.statusCode} in ${Date.now() - startedAt}ms`);
    });

    try {
      await server.connect(transport);
      await runWithApiClient(apiClient, () => transport.handleRequest(req, res, req.body));
    } catch (error) {
      console.error("[mcp] request failed:", (error as Error).message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  }
);

// Stateless server: no standalone SSE stream and no sessions to delete.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// JSON-RPC shaped errors for body-parser failures (never Express's HTML stack page).
app.use((error: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);
  const tooLarge = error.type === "entity.too.large";
  const parseFailed = error.type === "entity.parse.failed";
  res.status(tooLarge ? 413 : parseFailed ? 400 : 500).json({
    jsonrpc: "2.0",
    error: {
      code: parseFailed ? -32700 : -32603,
      message: tooLarge ? "Request body too large" : parseFailed ? "Parse error" : "Internal server error"
    },
    id: null
  });
});

// Express 5 hands bind errors (e.g. EADDRINUSE) to this callback instead of throwing.
app.listen(PORT, HOST, (error?: Error) => {
  if (error) {
    console.error(`Failed to start MCP HTTP server on ${HOST}:${PORT}:`, error.message);
    process.exit(1);
  }
  console.log(`60db MCP HTTP server v${SERVER_VERSION} listening on http://${HOST}:${PORT}/mcp`);
  console.log(`Public URL: ${PUBLIC_MCP_URL} | API: ${API_BASE_URL} | OAuth: ${oauth ? `enabled${GOOGLE_CLIENT_ID ? " (+Google)" : ""}` : "disabled (set MCP_OAUTH_SECRET)"}`);
});
