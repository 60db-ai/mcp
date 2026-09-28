/**
 * Short-lived public hosting for generated audio (hosted mode only).
 *
 * The 60db TTS endpoint streams raw audio bytes and persists nothing, and chat
 * clients such as Claude.ai can't play inline base64 audio from a tool. So the
 * hosted server writes each result to disk under an unguessable 128-bit id and
 * serves it at `${publicBaseUrl}/audio/<id>.<ext>` for 24 hours. Files live on
 * local disk, so every pm2 worker on this machine can serve every file.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const RETENTION_MS = 24 * 60 * 60 * 1000;
const EXT_BY_MIME: Record<string, string> = { "audio/wav": "wav", "audio/mpeg": "mp3", "audio/ogg": "ogg" };
export const MIME_BY_EXT: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" };
export const AUDIO_FILE_PATTERN = /^[a-f0-9]{32}\.(wav|mp3|ogg)$/;

let store: { dir: string; publicBaseUrl: string } | undefined;

export function configureAudioStore(dir: string, publicBaseUrl: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  store = { dir, publicBaseUrl: publicBaseUrl.replace(/\/$/, "") };
  setInterval(() => purgeExpiredAudio(dir), 60 * 60 * 1000).unref();
  purgeExpiredAudio(dir);
}

export function getAudioStoreDir(): string | undefined {
  return store?.dir;
}

/** Saves audio and returns its public URL, or undefined when not configured (stdio). */
export function saveTemporaryAudio(buffer: Buffer, mimeType: string): string | undefined {
  if (!store) return undefined;
  const fileName = `${randomBytes(16).toString("hex")}.${EXT_BY_MIME[mimeType] || "wav"}`;
  writeFileSync(path.join(store.dir, fileName), buffer, { mode: 0o600 });
  return `${store.publicBaseUrl}/audio/${fileName}`;
}

function purgeExpiredAudio(dir: string): void {
  try {
    const cutoff = Date.now() - RETENTION_MS;
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
    }
  } catch (error) {
    console.error("[audio] purge failed:", (error as Error).message);
  }
}

/** Express handler for GET /audio/:file — strict filename check blocks path traversal. */
export function serveTemporaryAudio(
  req: { params: Record<string, string> },
  res: {
    status: (code: number) => { end: () => void };
    set: (headers: Record<string, string>) => void;
    sendFile: (file: string, cb: (err?: Error) => void) => void;
    headersSent?: boolean;
  }
): void {
  const file = req.params.file || "";
  const match = AUDIO_FILE_PATTERN.exec(file);
  if (!store || !match) {
    res.status(404).end();
    return;
  }
  res.set({
    "Content-Type": MIME_BY_EXT[match[1]],
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*"
  });
  res.sendFile(path.join(store.dir, file), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}
