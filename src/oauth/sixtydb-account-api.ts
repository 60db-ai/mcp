/**
 * Calls to the existing 60db account endpoints used by the OAuth sign-in page.
 * No backend changes are needed: we log the user in exactly like the dashboard
 * does, then mint a workspace API key named after the connecting AI client.
 * That key is what the OAuth access token carries, so revoking the key in the
 * dashboard (Developer → API keys) disconnects the client.
 */

import axios, { AxiosError } from "axios";

export type LoginResult =
  | { kind: "token"; jwt: string; email?: string }
  | { kind: "two_factor"; tempToken: string }
  | { kind: "error"; message: string };

export class SixtydbAccountApi {
  constructor(private readonly apiBaseUrl: string) {}

  private async post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return axios.post(`${this.apiBaseUrl}${path}`, body, {
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      timeout: 15_000,
      validateStatus: () => true
    });
  }

  private static toLoginResult(status: number, data: any): LoginResult {
    if (status >= 200 && status < 300 && data?.requires_2fa && data?.temp_token) {
      return { kind: "two_factor", tempToken: data.temp_token };
    }
    if (status >= 200 && status < 300 && data?.token) {
      return { kind: "token", jwt: data.token, email: data.user?.email };
    }
    if (status === 429) {
      return { kind: "error", message: "Too many attempts. Please wait a minute and try again." };
    }
    const message = typeof data?.message === "string" ? data.message : "Sign-in failed. Please try again.";
    return { kind: "error", message };
  }

  async loginWithPassword(email: string, password: string, clientIp?: string): Promise<LoginResult> {
    try {
      const res = await this.post("/auth/login", { email, password }, forwardedFor(clientIp));
      return SixtydbAccountApi.toLoginResult(res.status, res.data);
    } catch (error) {
      return networkError(error);
    }
  }

  async loginWithGoogle(credential: string, clientIp?: string): Promise<LoginResult> {
    try {
      const res = await this.post("/auth/google", { credential }, forwardedFor(clientIp));
      return SixtydbAccountApi.toLoginResult(res.status, res.data);
    } catch (error) {
      return networkError(error);
    }
  }

  async verifyTwoFactor(tempToken: string, code: string, clientIp?: string): Promise<LoginResult> {
    try {
      const res = await this.post(
        "/auth/2fa/verify",
        { temp_token: tempToken, totp_code: code },
        forwardedFor(clientIp)
      );
      return SixtydbAccountApi.toLoginResult(res.status, res.data);
    } catch (error) {
      return networkError(error);
    }
  }

  /**
   * Creates a workspace API key for the signed-in user (primary workspace).
   * The name identifies app, destination and user so it's recognisable in the
   * dashboard's API key list.
   */
  async createConnectorApiKey(
    jwt: string,
    connection: { clientName: string; destination: string; email?: string }
  ): Promise<{ apiKey: string } | { error: string }> {
    try {
      const who = connection.email ? ` · ${connection.email}` : "";
      const name = `${connection.clientName} via ${connection.destination} (MCP connector${who})`.slice(0, 150);
      const auth = { Authorization: `Bearer ${jwt}` };
      const res = await this.post("/developer/api", { name }, auth);
      const apiKey = res.data?.data?.api_key;
      if (res.status >= 200 && res.status < 300 && typeof apiKey === "string") {
        // Only when the name is user-specific (email known): never touch other users' keys.
        if (connection.email) await this.deleteOlderConnectorKeys(name, res.data?.data?.hash_id, auth);
        return { apiKey };
      }
      if (res.status === 403) {
        return {
          error:
            "Your role in this workspace can't create API keys. Ask a workspace owner or admin to connect, or to change your role."
        };
      }
      return { error: res.data?.message || "Could not create access for this connection." };
    } catch (error) {
      return { error: (networkError(error) as { message: string }).message };
    }
  }

  /**
   * Reconnecting the same app replaces the user's previous connector key instead of
   * piling up keys. Matches the exact key name (app + destination + email) and only
   * "(MCP connector" keys; best effort — a failure just leaves an extra key behind.
   */
  private async deleteOlderConnectorKeys(
    name: string,
    keepHashId: string | undefined,
    auth: Record<string, string>
  ): Promise<void> {
    if (!keepHashId || !name.includes("(MCP connector")) return;
    try {
      const list = await axios.get(`${this.apiBaseUrl}/developer/api`, { headers: auth, timeout: 10_000 });
      const stale = ((list.data?.data || []) as Array<{ name?: string; hash_id?: string }>).filter(
        (key) => key.name === name && key.hash_id && key.hash_id !== keepHashId
      );
      for (const key of stale) {
        await axios.delete(`${this.apiBaseUrl}/developer/api/${encodeURIComponent(key.hash_id!)}`, {
          headers: auth,
          timeout: 10_000
        });
      }
      if (stale.length) console.log(`[oauth] replaced ${stale.length} older connector key(s)`);
    } catch (error) {
      console.error("[oauth] could not clean up older connector keys:", (error as Error).message);
    }
  }
}

function forwardedFor(clientIp?: string): Record<string, string> {
  return clientIp ? { "X-Forwarded-For": clientIp } : {};
}

function networkError(error: unknown): LoginResult {
  console.error("[oauth] 60db API unreachable:", (error as AxiosError).message);
  return { kind: "error", message: "60db is temporarily unavailable. Please try again." };
}
