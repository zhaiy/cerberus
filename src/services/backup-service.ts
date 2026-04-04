import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

import { CerberusError, ErrorCode } from "../core/errors.js";
import { isVaultFullyInitialized } from "../core/paths.js";
import type { AppPaths } from "../core/types.js";
import { withVaultWriteLock } from "../core/vault-lock.js";
import { openDatabase } from "../storage/db.js";

// ── Types ──

export interface BackupManifestFile {
  /** Relative path within the backup directory */
  path: string;
  /** Hex-encoded SHA-256 digest */
  sha256: string;
  /** File size in bytes */
  sizeBytes: number;
}

export interface BackupManifest {
  /** Manifest schema version */
  version: 1;
  /** ISO timestamp of when the backup was created */
  createdAt: string;
  /** The vault config version at the time of backup */
  vaultVersion: number;
  /** Total number of files in the backup */
  totalFiles: number;
  /** Per-file manifest entries */
  files: BackupManifestFile[];
}

// ── Internals ──

async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const rs = createReadStream(filePath);
    rs.on("data", (chunk) => hash.update(chunk));
    rs.on("end", () => resolve(hash.digest("hex")));
    rs.on("error", reject);
  });
}

interface FileToCopy {
  src: string;
  /** Relative destination path within the backup directory */
  rel: string;
}

/**
 * Collect all vault files that should be included in a backup.
 * Returns absolute source paths paired with their relative destination.
 */
async function collectVaultFiles(appPaths: AppPaths): Promise<FileToCopy[]> {
  const files: FileToCopy[] = [];

  // Core vault files
  const coreFiles: Array<{ abs: string; rel: string }> = [
    { abs: appPaths.configPath, rel: "config.json" },
    { abs: appPaths.wrappedIdentityPath, rel: "keys/identity.age.enc" },
  ];

  for (const { abs, rel } of coreFiles) {
    try {
      await fs.access(abs);
      files.push({ src: abs, rel });
    } catch {
      throw new CerberusError(
        `Required vault file not found: ${rel}`,
        ErrorCode.BACKUP_FAILED,
      );
    }
  }

  // Encrypted entry files
  await collectDirectoryFiles(appPaths.entriesDir, "vault/entries", files);
  // Encrypted attachment files
  await collectDirectoryFiles(
    appPaths.attachmentsDir,
    "vault/attachments",
    files,
  );

  return files;
}

async function collectDirectoryFiles(
  dirPath: string,
  relPrefix: string,
  files: FileToCopy[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    // Directory might not exist if vault has no entries/attachments yet
    return;
  }

  for (const name of entries) {
    const abs = path.join(dirPath, name);
    const st = await fs.stat(abs);
    if (st.isFile()) {
      files.push({ src: abs, rel: `${relPrefix}/${name}` });
    }
  }
}

async function createDatabaseSnapshot(
  appPaths: AppPaths,
  destinationPath: string,
): Promise<void> {
  const db = openDatabase(appPaths);
  try {
    await db.backup(destinationPath);
  } finally {
    db.close();
  }
}

function normalizeManifestPath(relPath: string): string | null {
  if (!relPath || relPath.includes("\\")) {
    return null;
  }
  if (path.posix.isAbsolute(relPath)) {
    return null;
  }

  const normalized = path.posix.normalize(relPath);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    return null;
  }

  return normalized;
}

async function listBackupFiles(
  rootDir: string,
  currentDir = rootDir,
): Promise<string[]> {
  let dirEntries: import("node:fs").Dirent[];
  try {
    dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of dirEntries) {
    const absPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listBackupFiles(rootDir, absPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push(path.relative(rootDir, absPath).split(path.sep).join("/"));
  }
  return files;
}

// ── Public API: create ──

export interface CreateBackupOptions {
  /** Absolute path to the output directory */
  outputDir: string;
}

/**
 * Create a full backup of the vault at the given paths.
 *
 * Backup structure:
 *   <outputDir>/
 *     manifest.json
 *     config.json
 *     db.sqlite
 *     keys/
 *       identity.age.enc
 *     vault/
 *       entries/*.age
 *       attachments/*.age
 */
export async function createBackup(
  appPaths: AppPaths,
  options: CreateBackupOptions,
): Promise<void> {
  const { outputDir } = options;

  // Validate vault is ready
  const initialized = await isVaultFullyInitialized(appPaths);
  if (!initialized) {
    throw new CerberusError(
      "Vault is not initialized. Run `cerberus init` first.",
      ErrorCode.VAULT_NOT_FOUND,
    );
  }

  // Ensure output dir doesn't already exist (avoid overwriting)
  try {
    await fs.access(outputDir);
    throw new CerberusError(
      `Output directory already exists: ${outputDir}`,
      ErrorCode.BACKUP_FAILED,
    );
  } catch (e) {
    if (e instanceof CerberusError) throw e;
    // Expected: access() throws when dir doesn't exist
  }

  await withVaultWriteLock(appPaths, async () => {
    // Collect files while writers are blocked, so the file set and database snapshot
    // describe the same vault state.
    const vaultFiles = await collectVaultFiles(appPaths);

    // Create output directory structure
    await fs.mkdir(outputDir, { recursive: true });
    const subDirs = new Set<string>(["keys"]);
    for (const { rel } of vaultFiles) {
      const dir = path.dirname(rel);
      if (dir !== ".") subDirs.add(dir);
    }
    for (const dir of subDirs) {
      await fs.mkdir(path.join(outputDir, dir), { recursive: true });
    }

    // Snapshot the SQLite database in a WAL-safe way while the write lock is held.
    await createDatabaseSnapshot(appPaths, path.join(outputDir, "db.sqlite"));

    // Copy files and compute digests
    const manifestFiles: BackupManifestFile[] = [];

    for (const { src, rel } of vaultFiles) {
      const destPath = path.join(outputDir, rel);
      await fs.copyFile(src, destPath);

      const sha256 = await sha256OfFile(destPath);
      const st = await fs.stat(destPath);

      manifestFiles.push({
        path: rel,
        sha256,
        sizeBytes: st.size,
      });
    }

    const dbSnapshotPath = path.join(outputDir, "db.sqlite");
    const dbSnapshotStat = await fs.stat(dbSnapshotPath);
    manifestFiles.push({
      path: "db.sqlite",
      sha256: await sha256OfFile(dbSnapshotPath),
      sizeBytes: dbSnapshotStat.size,
    });
    manifestFiles.sort((a, b) => a.path.localeCompare(b.path));

    // Generate manifest
    const manifest: BackupManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      vaultVersion: 1,
      totalFiles: manifestFiles.length,
      files: manifestFiles,
    };

    const manifestPath = path.join(outputDir, "manifest.json");
    const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
    await fs.writeFile(manifestPath, manifestJson, "utf8");
  });
}

// ── Public API: verify ──

export interface VerifyBackupResult {
  /** Number of files verified */
  totalFiles: number;
  /** List of errors found (empty when backup is valid) */
  errors: string[];
}

/**
 * Verify a backup directory against its manifest.
 *
 * Checks:
 *  - manifest.json exists and is valid JSON
 *  - manifest schema version is supported
 *  - every file listed in the manifest exists on disk
 *  - every file's SHA-256 digest matches
 *  - no extra files in the backup directory (beyond manifest entries)
 */
export async function verifyBackup(
  backupDir: string,
): Promise<VerifyBackupResult> {
  const errors: string[] = [];
  const backupRoot = path.resolve(backupDir);
  const requiredFiles = new Set([
    "config.json",
    "db.sqlite",
    "keys/identity.age.enc",
  ]);

  // 1. Read manifest
  const manifestPath = path.join(backupRoot, "manifest.json");
  let manifest: BackupManifest;

  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    manifest = JSON.parse(raw);
  } catch {
    return {
      totalFiles: 0,
      errors: ["manifest.json is missing or not valid JSON"],
    };
  }

  // 2. Validate manifest schema
  if (manifest.version !== 1) {
    errors.push(`Unsupported manifest version: ${manifest.version}`);
  }
  if (!Array.isArray(manifest.files)) {
    errors.push("manifest.files is missing or not an array");
    return { totalFiles: 0, errors };
  }
  if (manifest.totalFiles !== manifest.files.length) {
    errors.push(
      `totalFiles (${manifest.totalFiles}) does not match files array length (${manifest.files.length})`,
    );
  }
  const manifestPaths = new Set<string>();

  // 3. Check each file exists and digest matches
  for (const entry of manifest.files) {
    if (
      typeof entry?.path !== "string" ||
      typeof entry?.sha256 !== "string" ||
      typeof entry?.sizeBytes !== "number"
    ) {
      errors.push("manifest entry is missing required fields");
      continue;
    }
    const normalizedPath = normalizeManifestPath(entry.path);
    if (!normalizedPath) {
      errors.push(`invalid manifest path: ${String(entry.path)}`);
      continue;
    }
    if (manifestPaths.has(normalizedPath)) {
      errors.push(`duplicate manifest path: ${normalizedPath}`);
      continue;
    }
    manifestPaths.add(normalizedPath);

    const filePath = path.resolve(backupRoot, normalizedPath);
    if (!filePath.startsWith(`${backupRoot}${path.sep}`)) {
      errors.push(`manifest path escapes backup root: ${normalizedPath}`);
      continue;
    }

    // Existence
    try {
      await fs.access(filePath);
    } catch {
      errors.push(`missing file: ${entry.path}`);
      continue;
    }

    // Size check
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(filePath);
    } catch {
      errors.push(`cannot stat file: ${entry.path}`);
      continue;
    }
    if (st.size !== entry.sizeBytes) {
      errors.push(
        `size mismatch: ${entry.path} (expected ${entry.sizeBytes}, got ${st.size})`,
      );
    }

    // Digest check
    const actualSha256 = await sha256OfFile(filePath);
    if (actualSha256 !== entry.sha256) {
      errors.push(`digest mismatch: ${normalizedPath}`);
    }
  }

  for (const requiredPath of requiredFiles) {
    if (!manifestPaths.has(requiredPath)) {
      errors.push(`missing required manifest entry: ${requiredPath}`);
    }
  }

  const actualFiles = new Set(
    (await listBackupFiles(backupRoot)).filter((file) => file !== "manifest.json"),
  );
  for (const manifestPathEntry of manifestPaths) {
    if (!actualFiles.has(manifestPathEntry)) {
      errors.push(`manifest references missing file: ${manifestPathEntry}`);
    }
  }
  for (const actualFile of actualFiles) {
    if (!manifestPaths.has(actualFile)) {
      errors.push(`unexpected file in backup: ${actualFile}`);
    }
  }

  return {
    totalFiles: manifest.files.length,
    errors,
  };
}
