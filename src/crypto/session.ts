import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AppPaths } from "../core/types.js";

const SESSION_FILE_PREFIX = "session-";
const ACTIVE_SESSION_FILE = "session-active";
const SESSION_KEY_LENGTH = 32;
const SESSION_NONCE_LENGTH = 12;
const SESSION_TAG_LENGTH = 16;

interface SessionPayload {
  /** ISO-8601 timestamp when this session expires. */
  expiresAt: string;
  /** Hex-encoded random token for integrity checks. */
  token: string;
}

/**
 * Derive an ephemeral AES-256 key from the session token, used to
 * encrypt the age identity at rest in the session file. This avoids
 * storing the raw identity on disk even inside the session cache.
 */
function deriveSessionKey(token: string): Buffer {
  return crypto.createHash("sha256").update(token).digest();
}

function sessionFilePath(paths: AppPaths): string {
  return path.join(paths.sessionsDir, ACTIVE_SESSION_FILE);
}

async function removeFileIfExists(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch(() => {});
}

/**
 * Build the session file contents: JSON header + encrypted identity.
 *
 * File layout (all buffers):
 *   [4 bytes: header length, big-endian uint32]
 *   [headerLength bytes: JSON-encoded SessionPayload]
 *   [12 bytes: nonce]
 *   [ciphertext bytes]
 *   [16 bytes: AES-GCM auth tag]
 */
function encodeSessionFile(
  payload: SessionPayload,
  identityPlain: Buffer,
): Buffer {
  const sessionKey = deriveSessionKey(payload.token);
  const nonce = crypto.randomBytes(SESSION_NONCE_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(identityPlain), cipher.final()]);
  const tag = cipher.getAuthTag();

  const headerBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32BE(headerBuf.length, 0);

  return Buffer.concat([headerLen, headerBuf, nonce, ciphertext, tag]);
}

/**
 * Parse a session file and decrypt the identity inside it.
 * Returns null if the file cannot be read, is malformed, or has expired.
 */
function decodeSessionFile(
  raw: Buffer,
  now: Date,
): { identityPlain: Buffer; expiresAt: Date } | null {
  if (raw.length < 4) return null;

  const headerLen = raw.readUInt32BE(0);
  if (raw.length < 4 + headerLen + SESSION_NONCE_LENGTH + SESSION_TAG_LENGTH) {
    return null;
  }

  let payload: SessionPayload;
  try {
    const headerJson = raw.subarray(4, 4 + headerLen).toString("utf8");
    payload = JSON.parse(headerJson) as SessionPayload;
  } catch {
    return null;
  }

  if (typeof payload.token !== "string" || typeof payload.expiresAt !== "string") {
    return null;
  }

  const expiresAt = new Date(payload.expiresAt);
  if (isNaN(expiresAt.getTime())) return null;
  if (expiresAt <= now) return null;

  const nonce = raw.subarray(4 + headerLen, 4 + headerLen + SESSION_NONCE_LENGTH);
  const remaining = raw.subarray(4 + headerLen + SESSION_NONCE_LENGTH);
  if (remaining.length < SESSION_TAG_LENGTH) return null;

  const tag = remaining.subarray(remaining.length - SESSION_TAG_LENGTH);
  const ciphertext = remaining.subarray(0, remaining.length - SESSION_TAG_LENGTH);

  const sessionKey = deriveSessionKey(payload.token);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", sessionKey, nonce);
    decipher.setAuthTag(tag);
    const identityPlain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { identityPlain, expiresAt };
  } catch {
    return null;
  }
}

/**
 * Create a new short-lived session: unwrap the identity, write it encrypted
 * to a session file shared by subsequent CLI invocations for this vault.
 */
export async function openSession(
  paths: AppPaths,
  identityPlain: Buffer,
  ttlMinutes: number,
): Promise<void> {
  await fs.mkdir(paths.sessionsDir, { recursive: true });

  const token = crypto.randomBytes(SESSION_KEY_LENGTH).toString("hex");
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  const payload: SessionPayload = { expiresAt: expiresAt.toISOString(), token };
  const fileContent = encodeSessionFile(payload, identityPlain);

  const filePath = sessionFilePath(paths);
  await fs.writeFile(filePath, fileContent, { mode: 0o600 });
}

/**
 * Retrieve the decrypted identity from the current session, if it exists
 * and has not expired. Returns null if no valid session is found.
 */
export async function getActiveSession(
  paths: AppPaths,
): Promise<{ identityPlain: Buffer; expiresAt: Date } | null> {
  const filePath = sessionFilePath(paths);
  let raw: Buffer;
  try {
    raw = await fs.readFile(filePath);
  } catch {
    return null;
  }
  const result = decodeSessionFile(raw, new Date());
  if (!result) {
    // Session file is invalid or expired — remove it
    await fs.unlink(filePath).catch(() => {});
    return null;
  }
  return result;
}

/**
 * Remove the current process session file.
 */
export async function closeSession(paths: AppPaths): Promise<void> {
  const filePath = sessionFilePath(paths);
  await removeFileIfExists(filePath);
}

/**
 * Remove all session files that have passed their expiry time.
 * Called opportunistically during unlock and session checks.
 */
export async function cleanExpiredSessions(paths: AppPaths): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(paths.sessionsDir);
  } catch {
    return;
  }

  const now = new Date();
  for (const entry of entries) {
    if (entry !== ACTIVE_SESSION_FILE && !entry.startsWith(SESSION_FILE_PREFIX)) {
      continue;
    }
    const fullPath = path.join(paths.sessionsDir, entry);
    let raw: Buffer;
    try {
      raw = await fs.readFile(fullPath);
    } catch {
      continue;
    }
    const decoded = decodeSessionFile(raw, now);
    if (!decoded) {
      await removeFileIfExists(fullPath);
    }
  }
}
