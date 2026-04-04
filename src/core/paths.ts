import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AppPaths } from "./types.js";

export interface PathOverrides {
  homeDir?: string;
  appDir?: string;
}

export function resolveAppPaths(overrides?: PathOverrides): AppPaths {
  const homeDir = overrides?.homeDir
    ? path.resolve(overrides.homeDir)
    : os.homedir();
  const appDir = overrides?.appDir
    ? path.resolve(overrides.appDir)
    : path.join(homeDir, ".cerberus");
  const vaultDir = path.join(appDir, "vault");

  return {
    homeDir,
    appDir,
    vaultDir,
    entriesDir: path.join(vaultDir, "entries"),
    attachmentsDir: path.join(vaultDir, "attachments"),
    configPath: path.join(appDir, "config.json"),
    dbPath: path.join(appDir, "db.sqlite"),
    keysDir: path.join(appDir, "keys"),
    wrappedIdentityPath: path.join(appDir, "keys", "identity.age.enc"),
    sessionsDir: path.join(appDir, "sessions"),
  };
}

export type VaultInitState = "none" | "complete" | "partial";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Core artifacts that must all exist for a usable vault. */
export async function isVaultFullyInitialized(appPaths: AppPaths): Promise<boolean> {
  const hasConfig = await pathExists(appPaths.configPath);
  const hasIdentity = await pathExists(appPaths.wrappedIdentityPath);
  const hasDb = await pathExists(appPaths.dbPath);
  if (!hasConfig || !hasIdentity || !hasDb) {
    return false;
  }
  try {
    const st = await fs.stat(appPaths.wrappedIdentityPath);
    if (st.size < 32) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Whether any vault data exists that is not a complete vault.
 * Used before init to refuse a dirty tree without leaking which files are missing.
 */
export async function getVaultInitState(appPaths: AppPaths): Promise<VaultInitState> {
  const appDirExists = await pathExists(appPaths.appDir);
  if (!appDirExists) {
    return "none";
  }

  if (await isVaultFullyInitialized(appPaths)) {
    return "complete";
  }

  const hasConfig = await pathExists(appPaths.configPath);
  const hasIdentity = await pathExists(appPaths.wrappedIdentityPath);
  const hasDb = await pathExists(appPaths.dbPath);
  if (hasConfig || hasIdentity || hasDb) {
    return "partial";
  }

  let entries: string[];
  try {
    entries = await fs.readdir(appPaths.appDir);
  } catch {
    return "partial";
  }
  if (entries.length === 0) {
    return "none";
  }
  return "partial";
}

/** True when config, wrapped identity, and database are all present (for loadConfig and guards). */
export async function isVaultInitialized(appPaths: AppPaths): Promise<boolean> {
  return isVaultFullyInitialized(appPaths);
}

export async function ensureAppDirectories(appPaths: AppPaths): Promise<void> {
  const dirs = [
    appPaths.appDir,
    appPaths.vaultDir,
    appPaths.entriesDir,
    appPaths.attachmentsDir,
    appPaths.keysDir,
    appPaths.sessionsDir,
  ];

  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));
}
