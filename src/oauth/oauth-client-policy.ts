/**
 * Registration and display policy for dynamically registered OAuth clients.
 *
 * DCR is open (Claude.ai / ChatGPT require it), so client metadata is
 * attacker-controlled. We restrict redirect URIs, sanitise display names and
 * flag any client that doesn't redirect to a known AI app as "unverified" on
 * the sign-in page, so a look-alike "Claude" can't silently phish a 60db login.
 */

const TRUSTED_REDIRECT_HOSTS = new Set([
  "claude.ai",
  "claude.com",
  "chatgpt.com",
  "chat.openai.com",
  "platform.openai.com"
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Private-use schemes of desktop MCP clients (RFC 8252 §7.1).
const ALLOWED_CUSTOM_SCHEMES = new Set(["cursor:", "vscode:", "vscode-insiders:", "windsurf:", "claude:"]);
const MAX_CLIENT_NAME = 60;

/** Returns an error message when a redirect URI is not acceptable for registration. */
export function redirectUriPolicyError(uri: string): string | undefined {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return `Invalid redirect_uri: ${uri.slice(0, 100)}`;
  }
  if (url.hash) return "redirect_uri must not contain a fragment";
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return undefined;
  if (ALLOWED_CUSTOM_SCHEMES.has(url.protocol)) return undefined;
  return "redirect_uri must use https, a loopback http address, or a supported app scheme";
}

/** Known AI assistants and native/loopback apps; everything else is shown as unverified. */
export function isTrustedRedirect(uri: string): boolean {
  const url = new URL(uri);
  if (url.protocol === "https:") return TRUSTED_REDIRECT_HOSTS.has(url.hostname);
  return true; // loopback / private-use scheme: the app runs on the user's own machine
}

/** Human-readable destination shown on the consent page and in the API key name. */
export function redirectLabel(uri: string): string {
  const url = new URL(uri);
  return url.protocol === "https:" || url.protocol === "http:" ? url.host : url.protocol.replace(":", " app");
}

/** CSP form-action source that allows the post-login 303 redirect to this URI only. */
export function formActionSource(uri: string): string {
  const url = new URL(uri);
  return url.protocol === "https:" || url.protocol === "http:" ? url.origin : url.protocol;
}

/** Strips control / bidi / zero-width characters and caps length. */
export function sanitizeClientName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const clean = name
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CLIENT_NAME);
  return clean || undefined;
}
