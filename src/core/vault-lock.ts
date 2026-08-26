import fs from "node:fs/promises";
import path from "node:path";

import type { AppPaths } from "./types.js";
import { CerberusError, ErrorCode } from "./errors.js";

const LOCK_DIR_NAME = ".vault-write-lock";
const LOCK_INFO_FILE = "lock.json";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_MS = 5 * 60_000;
const POLL_MS = 100;

interface LockMetadata {
  pid: number;
  createdAt: string;
}

function getLockDir(paths: AppPaths): string {
  return path.join(paths.appDir, LOCK_DIR_NAME);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "";
    return code !== "ESRCH";
  }
}

async function readLockMetadata(lockDir: string): Promise<LockMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(lockDir, LOCK_INFO_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<LockMetadata>;
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.createdAt === "string"
    ) {
      return {
        pid: parsed.pid,
        createdAt: parsed.createdAt,
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function removeLockDir(lockDir: string): Promise<void> {
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryAcquireVaultLock(paths: AppPaths): Promise<(() => Promise<void>) | null> {
  const lockDir = getLockDir(paths);
  // Ensure the parent app directory exists so the (non-recursive) lock mkdir
  // can succeed on a fresh vault. The lock itself stays non-recursive so its
  // EEXIST-based mutual exclusion is preserved.
  await fs.mkdir(paths.appDir, { recursive: true });
  try {
    await fs.mkdir(lockDir);
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "";
    if (code === "EEXIST") {
      return null;
    }
    throw error;
  }

  const metadata: LockMetadata = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(lockDir, LOCK_INFO_FILE),
    JSON.stringify(metadata),
    { mode: 0o600 },
  );

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    await removeLockDir(lockDir);
  };
}

async function clearStaleLock(paths: AppPaths, staleMs: number): Promise<void> {
  const lockDir = getLockDir(paths);
  const metadata = await readLockMetadata(lockDir);
  if (!metadata) {
    await removeLockDir(lockDir);
    return;
  }

  const createdAt = new Date(metadata.createdAt);
  const ageMs = Date.now() - createdAt.getTime();
  if (!Number.isNaN(createdAt.getTime()) && ageMs < staleMs && isProcessAlive(metadata.pid)) {
    return;
  }

  await removeLockDir(lockDir);
}

export async function withVaultWriteLock<T>(
  paths: AppPaths,
  action: () => Promise<T>,
  options?: { timeoutMs?: number; staleMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const release = await tryAcquireVaultLock(paths);
    if (release) {
      try {
        return await action();
      } finally {
        await release();
      }
    }

    await clearStaleLock(paths, staleMs);
    const afterCleanup = await tryAcquireVaultLock(paths);
    if (afterCleanup) {
      try {
        return await action();
      } finally {
        await afterCleanup();
      }
    }

    if (Date.now() >= deadline) {
      throw new CerberusError(
        "Vault is busy with another write operation. Please try again.",
        ErrorCode.UNKNOWN,
      );
    }
    await sleep(POLL_MS);
  }
}
