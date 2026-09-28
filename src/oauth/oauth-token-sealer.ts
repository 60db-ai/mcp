/**
 * Stateless sealed tokens for the MCP OAuth server.
 *
 * Every OAuth artefact (registered client ids, pending authorization requests,
 * authorization codes, access/refresh tokens) is an AES-256-GCM encrypted,
 * authenticated JSON payload. No database or shared cache is needed, so any
 * pm2 worker can serve any step of the flow. Tampering or a wrong `typ` fails
 * closed. Rotating MCP_OAUTH_SECRET invalidates everything (forces re-connect).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export type SealedType = "client" | "authreq" | "code" | "access" | "refresh" | "tfa";

interface SealedEnvelope {
  typ: SealedType;
  exp?: number; // epoch ms; omitted = no expiry
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class OAuthTokenSealer {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error("MCP_OAUTH_SECRET must be at least 32 characters");
    }
    this.key = createHash("sha256").update(secret).digest();
  }

  seal<T extends object>(typ: SealedType, payload: T, ttlMs?: number): string {
    const envelope: SealedEnvelope & T = {
      ...payload,
      typ,
      ...(ttlMs ? { exp: Date.now() + ttlMs } : {})
    };
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plain = deflateRawSync(Buffer.from(JSON.stringify(envelope)));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  }

  /** Returns the payload, or undefined when invalid, tampered, wrong type or expired. */
  open<T extends object>(typ: SealedType, token: string | undefined): (T & SealedEnvelope) | undefined {
    if (!token || token.length < 40 || token.length > 8192) return undefined;
    try {
      const raw = Buffer.from(token, "base64url");
      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
      const payload = JSON.parse(inflateRawSync(plain).toString("utf8")) as T & SealedEnvelope;
      if (payload.typ !== typ) return undefined;
      if (payload.exp && payload.exp < Date.now()) return undefined;
      return payload;
    } catch {
      return undefined;
    }
  }
}

/** Short stable fingerprint used to bind codes/tokens to a client id. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 22);
}
