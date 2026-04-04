import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AppPaths } from "../../src/core/types.js";
import {
  openSession,
  getActiveSession,
  closeSession,
  cleanExpiredSessions,
} from "../../src/crypto/session.js";

const ACTIVE_SESSION_FILE = "session-active";
const SESSION_FILE_PREFIX = "session-";

function tempPaths(root: string): AppPaths {
  return {
    homeDir: root,
    appDir: root,
    vaultDir: root,
    entriesDir: path.join(root, "entries"),
    attachmentsDir: path.join(root, "attachments"),
    configPath: path.join(root, "config.json"),
    dbPath: path.join(root, "db.sqlite"),
    keysDir: path.join(root, "keys"),
    wrappedIdentityPath: path.join(root, "keys", "id.age.enc"),
    sessionsDir: path.join(root, "sessions"),
  };
}

/**
 * Build a valid session file buffer that expires at `expiresAt`.
 * Mirrors the encodeSessionFile logic from session.ts.
 */
function buildSessionBuffer(identityPlain: Buffer, expiresAt: Date): Buffer {
  const token = crypto.randomBytes(32).toString("hex");
  const sessionKey = crypto.createHash("sha256").update(token).digest();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(identityPlain), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = { expiresAt: expiresAt.toISOString(), token };
  const headerBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32BE(headerBuf.length, 0);

  return Buffer.concat([headerLen, headerBuf, nonce, ciphertext, tag]);
}

describe("session management", () => {
  let root: string;
  let paths: AppPaths;

  afterEach(async () => {
    if (root) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("openSession → getActiveSession round-trip returns identity", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-session-"));
    paths = tempPaths(root);
    await fs.mkdir(paths.sessionsDir, { recursive: true });

    const identity = Buffer.from("test-identity-material-for-session");
    await openSession(paths, identity, 15);

    const session = await getActiveSession(paths);
    expect(session).not.toBeNull();
    expect(session!.identityPlain.toString()).toBe("test-identity-material-for-session");
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("getActiveSession returns null when no session exists", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-session-"));
    paths = tempPaths(root);
    await fs.mkdir(paths.sessionsDir, { recursive: true });

    const session = await getActiveSession(paths);
    expect(session).toBeNull();
  });

  it("closeSession removes the session file", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-session-"));
    paths = tempPaths(root);
    await fs.mkdir(paths.sessionsDir, { recursive: true });

    const identity = Buffer.from("to-be-closed");
    await openSession(paths, identity, 15);
    expect(await getActiveSession(paths)).not.toBeNull();

    await closeSession(paths);
    expect(await getActiveSession(paths)).toBeNull();
  });

  it("getActiveSession returns null for expired session", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-session-"));
    paths = tempPaths(root);
    await fs.mkdir(paths.sessionsDir, { recursive: true });

    const identity = Buffer.from("already-expired");
    // TTL of 0 minutes = already expired
    await openSession(paths, identity, 0);

    const session = await getActiveSession(paths);
    expect(session).toBeNull();
  });

  it("cleanExpiredSessions removes stale files but keeps the active valid session", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-session-"));
    paths = tempPaths(root);
    await fs.mkdir(paths.sessionsDir, { recursive: true });

    // Create the active session file used by the CLI across invocations
    await openSession(paths, Buffer.from("current-pid-valid"), 60);

    // Manually create an expired session file for a different PID
    const staleIdentity = Buffer.from("stale-identity");
    const expiredBuffer = buildSessionBuffer(staleIdentity, new Date(Date.now() - 60_000));
    const stalePath = path.join(paths.sessionsDir, `${SESSION_FILE_PREFIX}99999`);
    await fs.writeFile(stalePath, expiredBuffer, { mode: 0o600 });

    // Both files should exist
    const filesBefore = await fs.readdir(paths.sessionsDir);
    expect(filesBefore.length).toBe(2);

    await cleanExpiredSessions(paths);

    // Only the active session file should remain
    const filesAfter = await fs.readdir(paths.sessionsDir);
    expect(filesAfter.length).toBe(1);
    expect(filesAfter[0]).toBe(ACTIVE_SESSION_FILE);

    // Current session should still be valid
    const session = await getActiveSession(paths);
    expect(session).not.toBeNull();
    expect(session!.identityPlain.toString()).toBe("current-pid-valid");
  });
});
