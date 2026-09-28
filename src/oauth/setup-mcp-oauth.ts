/**
 * Mounts the OAuth 2.1 authorization server for Claude.ai / ChatGPT connectors.
 * This origin is the issuer. The SDK's mcpAuthRouter serves AS metadata,
 * /authorize, /token, /register (DCR), /revoke and the path-suffixed
 * protected-resource metadata; our provider renders the 60db sign-in page and
 * the login router completes it.
 */

import type { Express } from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { OAuthTokenSealer } from "./oauth-token-sealer.js";
import { SixtydbOAuthProvider } from "./sixtydb-oauth-provider.js";
import { SixtydbAccountApi } from "./sixtydb-account-api.js";
import { createOAuthLoginRouter } from "./oauth-login-router.js";

export interface McpOAuthConfig {
  secret: string;
  publicOrigin: string;
  publicMcpUrl: string;
  apiBaseUrl: string;
  documentationUrl: string;
  googleClientId?: string;
}

export interface McpOAuthHandle {
  /** Canonical issuer URL, exactly as advertised in the AS metadata. */
  issuer: string;
  /** Unseals an OAuth access token into the 60db API key it carries. */
  resolveApiKey: (accessToken: string) => string | undefined;
}

export function setupMcpOAuth(app: Express, config: McpOAuthConfig): McpOAuthHandle {
  const issuerUrl = new URL(config.publicOrigin);
  const provider = new SixtydbOAuthProvider(new OAuthTokenSealer(config.secret), config.googleClientId);

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      resourceServerUrl: new URL(config.publicMcpUrl),
      scopesSupported: ["mcp"],
      resourceName: "60db",
      serviceDocumentationUrl: new URL(config.documentationUrl),
      clientRegistrationOptions: { clientSecretExpirySeconds: 0 } // DCR secrets never expire
    })
  );
  app.use(
    createOAuthLoginRouter({
      provider,
      accountApi: new SixtydbAccountApi(config.apiBaseUrl),
      googleClientId: config.googleClientId
    })
  );

  return { issuer: issuerUrl.href, resolveApiKey: (token) => provider.resolveApiKey(token) };
}
