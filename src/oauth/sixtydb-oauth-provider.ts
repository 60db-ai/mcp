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
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTokenError
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { OAuthTokenSealer, fingerprint } from "./oauth-token-sealer.js";
import { renderLoginPage } from "./oauth-login-pages.js";
import {
  formActionSource,
  isTrustedRedirect,
  redirectLabel,
  redirectUriPolicyError,
  sanitizeClientName
} from "./oauth-client-policy.js";

const AUTH_REQUEST_TTL_MS = 15 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000; // stateless codes can't be single-use; keep the window short
const ACCESS_TOKEN_TTL_S = 60 * 60;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // sliding: every refresh issues a fresh one
// Prefixes keep sealed tokens distinguishable from raw `sk_` API keys.
const ACCESS_PREFIX = "60db_at_";
const REFRESH_PREFIX = "60db_rt_";

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
    for (const uri of client.redirect_uris) {
      const error = redirectUriPolicyError(uri);
      if (error) throw new InvalidClientMetadataError(error);
    }
    // Drop any SDK-generated id: the sealed client metadata *is* the client_id.
    const { client_id: _ignored, ...rest } = client as OAuthClientInformationFull;
    const metadata = { ...rest, client_name: sanitizeClientName(rest.client_name) };
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
      redirectHost: redirectLabel(params.redirectUri),
      verified: isTrustedRedirect(params.redirectUri),
      googleClientId: this.googleClientId
    });
    sendHtml(res, html, { googleClientId: this.googleClientId, redirectUri: params.redirectUri });
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
    const payload = this.sealer.open<TokenPayload>("refresh", stripPrefix(refreshToken, REFRESH_PREFIX));
    if (!payload || payload.cid !== fingerprint(client.client_id)) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    return this.issueTokens({ cid: payload.cid, k: payload.k });
  }

  private issueTokens(payload: TokenPayload): OAuthTokens {
    return {
      access_token: ACCESS_PREFIX + this.sealer.seal("access", payload, ACCESS_TOKEN_TTL_S * 1000),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      // Deleting the connector's API key in the dashboard ends access immediately.
      refresh_token: REFRESH_PREFIX + this.sealer.seal("refresh", payload, REFRESH_TOKEN_TTL_MS),
      scope: "mcp"
    };
  }

  /** The 60db API key behind an OAuth access token, or undefined if invalid/expired. */
  resolveApiKey(accessToken: string): string | undefined {
    return this.sealer.open<TokenPayload>("access", stripPrefix(accessToken, ACCESS_PREFIX))?.k;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = this.sealer.open<TokenPayload>("access", stripPrefix(token, ACCESS_PREFIX));
    if (!payload) throw new InvalidTokenError("Invalid or expired access token");
    return {
      token,
      clientId: payload.cid,
      scopes: ["mcp"],
      expiresAt: payload.exp ? Math.floor(payload.exp / 1000) : undefined
    };
  }
}

function stripPrefix(token: string, prefix: string): string | undefined {
  return token.startsWith(prefix) ? token.slice(prefix.length) : undefined;
}

export interface HtmlPageOptions {
  googleClientId?: string;
  /** When set, the form may redirect only to this client's origin/scheme (CSP form-action). */
  redirectUri?: string;
  status?: number;
}

/** Sends an HTML page with anti-framing + tight CSP (Google Identity allowed when enabled). */
export function sendHtml(res: Response, html: string, options: HtmlPageOptions = {}): void {
  const google = options.googleClientId ? " https://accounts.google.com/gsi/" : "";
  const redirectTarget = options.redirectUri ? ` ${formActionSource(options.redirectUri)}` : "";
  res
    .status(options.status ?? 200)
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
        `form-action 'self'${redirectTarget}`,
        "frame-ancestors 'none'",
        "base-uri 'none'"
      ].join("; ")
    })
    .send(html);
}
