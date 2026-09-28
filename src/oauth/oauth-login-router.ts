/**
 * POST /oauth/login — handles the 60db sign-in form rendered by /authorize.
 * Steps: password | google | 2fa. On success mints a workspace API key for the
 * connecting client and redirects back to it with an authorization code.
 */

import express, { type Request, type Response, Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { SixtydbOAuthProvider, PendingAuthRequest } from "./sixtydb-oauth-provider.js";
import { sendHtml } from "./sixtydb-oauth-provider.js";
import { SixtydbAccountApi, type LoginResult } from "./sixtydb-account-api.js";
import { renderErrorPage, renderLoginPage, renderTwoFactorPage } from "./oauth-login-pages.js";
import { isTrustedRedirect, redirectLabel } from "./oauth-client-policy.js";

const TFA_TTL_MS = 5 * 60 * 1000;
const field = (body: Record<string, unknown>, name: string, max = 4096): string =>
  typeof body[name] === "string" ? (body[name] as string).trim().slice(0, max) : "";

export function createOAuthLoginRouter(options: {
  provider: SixtydbOAuthProvider;
  accountApi: SixtydbAccountApi;
  googleClientId?: string;
}): Router {
  const { provider, accountApi, googleClientId } = options;
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip || "unknown"),
    handler: (_req, res) =>
      sendHtml(res, renderErrorPage("Too many sign-in attempts. Please wait 15 minutes."), { status: 429 })
  });

  router.post(
    "/oauth/login",
    loginLimiter,
    express.urlencoded({ extended: false, limit: "16kb" }),
    async (req: Request, res: Response) => {
      const body = (req.body || {}) as Record<string, unknown>;
      const sealedRequest = field(body, "request");
      const pending = provider.openAuthRequest(sealedRequest);
      if (!pending) {
        sendHtml(res, renderErrorPage("This sign-in link has expired."), { status: 400 });
        return;
      }
      // `pending` is sealed and was created only after the SDK validated redirect_uri
      // (including RFC 8252 loopback port matching), so only the client must still exist.
      const client = await provider.clientsStore.getClient(pending.cid);
      if (!client) {
        sendHtml(res, renderErrorPage("Unknown application. Please reconnect."), { status: 400 });
        return;
      }
      const clientName = client.client_name || "An AI assistant";
      const destination = redirectLabel(pending.ru);
      const page = { googleClientId, redirectUri: pending.ru };

      const showLogin = (error: string, email?: string) =>
        sendHtml(
          res,
          renderLoginPage({
            authRequest: sealedRequest,
            clientName,
            redirectHost: destination,
            verified: isTrustedRedirect(pending.ru),
            googleClientId,
            email,
            error
          }),
          { ...page, status: 400 }
        );

      const step = field(body, "step", 16);
      const email = field(body, "email", 320);
      let result: LoginResult;

      try {
        if (step === "password") {
          result = await accountApi.loginWithPassword(email, field(body, "password", 1024), req.ip);
        } else if (step === "google") {
          result = await accountApi.loginWithGoogle(field(body, "credential", 8192), req.ip);
        } else if (step === "2fa") {
          const tfa = provider.sealer.open<{ t: string }>("tfa", field(body, "tfa"));
          if (!tfa) return showLogin("Verification timed out. Please sign in again.");
          result = await accountApi.verifyTwoFactor(tfa.t, field(body, "code", 16).replace(/\s/g, ""), req.ip);
          if (result.kind === "error") {
            sendHtml(
              res,
              renderTwoFactorPage({ authRequest: sealedRequest, tfaToken: field(body, "tfa"), error: result.message }),
              { redirectUri: pending.ru, status: 400 }
            );
            return;
          }
        } else {
          return showLogin("Please sign in.");
        }
      } catch (error) {
        console.error("[oauth] login step failed:", (error as Error).message);
        return showLogin("Something went wrong. Please try again.", email);
      }

      if (result.kind === "error") return showLogin(result.message, email);
      if (result.kind === "two_factor") {
        const tfaToken = provider.sealer.seal("tfa", { t: result.tempToken }, TFA_TTL_MS);
        sendHtml(res, renderTwoFactorPage({ authRequest: sealedRequest, tfaToken }), { redirectUri: pending.ru });
        return;
      }

      await completeAuthorization(res, pending, result.jwt, { clientName, destination, email: result.email });
    }
  );

  async function completeAuthorization(
    res: Response,
    pending: PendingAuthRequest,
    jwt: string,
    connection: { clientName: string; destination: string; email?: string }
  ) {
    const created = await accountApi.createConnectorApiKey(jwt, connection);
    if ("error" in created) {
      sendHtml(res, renderErrorPage(created.error), { status: 403 });
      return;
    }
    const redirect = new URL(pending.ru);
    redirect.searchParams.set("code", provider.issueCode(pending, created.apiKey));
    if (pending.st) redirect.searchParams.set("state", pending.st);
    const safeName = connection.clientName.replace(/[^\w .()-]/g, "").slice(0, 60);
    console.log(`[oauth] connected client "${safeName}" -> ${connection.destination.replace(/[^\w.:-]/g, "")}`);
    res.redirect(303, redirect.toString());
  }

  return router;
}
