/**
 * OAuth 2.1 authorization server provider for mcp.60db.ai, plugged into the
 * MCP SDK's mcpAuthRouter (which implements metadata, DCR, /authorize
 * validation, PKCE checks and /token). Everything here is stateless: see
 * oauth-token-sealer.ts.
 *
 * Flow: Claude/ChatGPT → /authorize → 60db sign-in page (renderLoginPage) →
 * POST /oauth/login (oauth-login-router.ts) → code → /token → access token
 * that carries a workspace API key minted for this connection.
 */

import type { Response } from "express";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { OAuthTokenSealer, fingerprint } from "./oauth-token-sealer.js";
import { renderLoginPage } from "./oauth-login-pages.js";

const AUTH_REQUEST_TTL_MS = 15 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_S = 60 * 60;

/** Pending /authorize request carried through the sign-in form. */
export interface PendingAuthRequest {
  cid: string; // client_id
  ru: string; // redirect_uri
  cc: string; // PKCE code_challenge (S256)
  st?: string; // state
}

interface CodePayload { cid: string; ru: string; cc: string; k: string }
interface TokenPayload { cid: string; k: string }

class StatelessClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly sealer: OAuthTokenSealer) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const payload = this.sealer.open<Omit<OAuthClientInformationFull, "client_id">>("client", clientId);
    if (!payload) return undefined;
    const { typ: _typ, exp: _exp, ...client } = payload;
    return { ...client, client_id: clientId } as OAuthClientInformationFull;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): Promise<OAuthClientInformationFull> {
    // Drop any SDK-generated id: the sealed client metadata *is* the client_id.
    const { client_id: _ignored, ...metadata } = client as OAuthClientInformationFull;
    const issuedAt = Math.floor(Date.now() / 1000);
    const clientId = this.sealer.seal("client", { ...metadata, client_id_issued_at: issuedAt });
    return { ...metadata, client_id: clientId, client_id_issued_at: issuedAt } as OAuthClientInformationFull;
  }
}

export class SixtydbOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: StatelessClientsStore;

  constructor(
    readonly sealer: OAuthTokenSealer,
    private readonly googleClientId?: string
  ) {
    this.clientsStore = new StatelessClientsStore(sealer);
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const pending: PendingAuthRequest = {
      cid: client.client_id,
      ru: params.redirectUri,
      cc: params.codeChallenge,
      ...(params.state ? { st: params.state } : {})
    };
    const html = renderLoginPage({
      authRequest: this.sealer.seal("authreq", pending, AUTH_REQUEST_TTL_MS),
      clientName: client.client_name || "An AI assistant",
      redirectHost: new URL(params.redirectUri).host,
      googleClientId: this.googleClientId
    });
    sendHtml(res, html, this.googleClientId);
  }

  openAuthRequest(sealed: string | undefined): PendingAuthRequest | undefined {
    return this.sealer.open<PendingAuthRequest>("authreq", sealed);
  }

  /** Issues the authorization code once the user has signed in and a key exists. */
  issueCode(pending: PendingAuthRequest, apiKey: string): string {
    const payload: CodePayload = { cid: fingerprint(pending.cid), ru: pending.ru, cc: pending.cc, k: apiKey };
    return this.sealer.seal("code", payload, CODE_TTL_MS);
  }

  private openCode(client: OAuthClientInformationFull, code: string): CodePayload {
    const payload = this.sealer.open<CodePayload>("code", code);
    if (!payload || payload.cid !== fingerprint(client.client_id)) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    return payload;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.openCode(client, code).cc;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const payload = this.openCode(client, code);
    if (redirectUri && redirectUri !== payload.ru) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    return this.issueTokens({ cid: payload.cid, k: payload.k });
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const payload = this.sealer.open<TokenPayload>("refresh", refreshToken);
    if (!payload || payload.cid !== fingerprint(client.client_id)) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    return this.issueTokens({ cid: payload.cid, k: payload.k });
  }

  private issueTokens(payload: TokenPayload): OAuthTokens {
    return {
      access_token: this.sealer.seal("access", payload, ACCESS_TOKEN_TTL_S * 1000),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      // Refresh tokens don't expire; access ends when the API key is deleted.
      refresh_token: this.sealer.seal("refresh", payload),
      scope: "mcp"
    };
  }

  /** The 60db API key behind an OAuth access token, or undefined if invalid/expired. */
  resolveApiKey(accessToken: string): string | undefined {
    return this.sealer.open<TokenPayload>("access", accessToken)?.k;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = this.sealer.open<TokenPayload>("access", token);
    if (!payload) throw new InvalidTokenError("Invalid or expired access token");
    return {
      token,
      clientId: payload.cid,
      scopes: ["mcp"],
      expiresAt: payload.exp ? Math.floor(payload.exp / 1000) : undefined
    };
  }
}

/** Sends an HTML page with anti-framing + tight CSP (Google Identity allowed when enabled). */
export function sendHtml(res: Response, html: string, googleClientId?: string, status = 200): void {
  const google = googleClientId ? " https://accounts.google.com/gsi/" : "";
  res
    .status(status)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'unsafe-inline'${google}`,
        `style-src 'unsafe-inline'${google}`,
        `frame-src${google || " 'none'"}`,
        `connect-src${google || " 'none'"}`,
        "img-src https://60db.ai data:",
        "form-action 'self' https: http://localhost:* http://127.0.0.1:*",
        "frame-ancestors 'none'",
        "base-uri 'none'"
      ].join("; ")
    })
    .send(html);
}
