/**
 * Bearer-token gate for the hosted MCP endpoint.
 *
 * The MCP server is a thin proxy: it never issues or decodes credentials, it
 * only checks that the caller's token (60db API key `sk_...` or OAuth/JWT
 * access token) is accepted by the 60db API, and answers 401 with an RFC 9728
 * `WWW-Authenticate` challenge otherwise so MCP clients can start OAuth.
 */

import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import axios from "axios";

const VALID_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_TOKENS = 10_000;
const TOKEN_CHECK_TIMEOUT_MS = 10_000;

// sha256(token) -> expiry timestamp. Raw tokens are never kept in memory maps or logs.
const validTokenCache = new Map<string, number>();

export interface BearerAuthOptions {
  apiBaseUrl: string;
  resourceMetadataUrl: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

/** True when the token was verified recently — no API round-trip needed. */
export function isRecentlyVerifiedToken(token: string | undefined): boolean {
  if (!token) return false;
  const expiresAt = validTokenCache.get(hashToken(token));
  return !!expiresAt && expiresAt > Date.now();
}

/** Returns true (valid), false (rejected by API) — throws when the API is unreachable. */
async function isTokenAccepted(token: string, apiBaseUrl: string): Promise<boolean> {
  const key = hashToken(token);
  const expiresAt = validTokenCache.get(key);
  if (expiresAt && expiresAt > Date.now()) return true;

  // /authz/permissions accepts both API keys and JWTs and is cheap (no Cerbos check).
  const response = await axios.get(`${apiBaseUrl}/authz/permissions`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    timeout: TOKEN_CHECK_TIMEOUT_MS,
    validateStatus: () => true
  });

  if (response.status === 401) {
    validTokenCache.delete(key);
    return false;
  }
  // Only 2xx, or 403 (authenticated but lacking a permission), prove the token is
  // genuine. Anything else (429, 404, 5xx…) is inconclusive → caller answers 503.
  const accepted = (response.status >= 200 && response.status < 300) || response.status === 403;
  if (!accepted) {
    throw new Error(`Token check inconclusive: upstream status ${response.status}`);
  }

  if (validTokenCache.size >= MAX_CACHED_TOKENS) validTokenCache.clear();
  validTokenCache.set(key, Date.now() + VALID_TOKEN_TTL_MS);
  return true;
}

function sendUnauthorized(res: Response, resourceMetadataUrl: string, description: string): void {
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token", error_description="${description}"`
    )
    .json({
      jsonrpc: "2.0",
      error: { code: -32001, message: `Unauthorized: ${description}` },
      id: null
    });
}

export function requireBearerAuth(options: BearerAuthOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req);
    if (!token) {
      sendUnauthorized(
        res,
        options.resourceMetadataUrl,
        "Missing bearer token. Use a 60db API key (sk_...) or sign in with OAuth."
      );
      return;
    }

    try {
      if (!(await isTokenAccepted(token, options.apiBaseUrl))) {
        sendUnauthorized(res, options.resourceMetadataUrl, "Invalid or expired 60db credentials.");
        return;
      }
    } catch (error) {
      console.error("[auth] token check unavailable:", (error as Error).message);
      res.status(503).set("Retry-After", "5").json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "60db API is temporarily unavailable. Please retry." },
        id: null
      });
      return;
    }

    res.locals.bearerToken = token;
    next();
  };
}
