import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createBackup, verifyBackup } from "../../src/services/backup-service.js";
import { CerberusError } from "../../src/core/errors.js";
import type { AppPaths } from "../../src/core/types.js";
import { openDatabase, runMigrations } from "../../src/storage/db.js";
import { createEntryRecord } from "../../src/storage/entries.js";

function tempPaths(root: string): AppPaths {
  return {
    homeDir: root,
    appDir: root,
    vaultDir: path.join(root, "vault"),
    entriesDir: path.join(root, "vault", "entries"),
    attachmentsDir: path.join(root, "vault", "attachments"),
    configPath: path.join(root, "config.json"),
    dbPath: path.join(root, "db.sqlite"),
    keysDir: path.join(root, "keys"),
    wrappedIdentityPath: path.join(root, "keys", "identity.age.enc"),
    sessionsDir: path.join(root, "sessions"),
  };
}

/** Create a minimal but fully-initialized vault directory structure. */
async function setupVault(root: string): Promise<AppPaths> {
  const paths = tempPaths(root);

  // Create directory structure
  await fs.mkdir(paths.entriesDir, { recursive: true });
  await fs.mkdir(paths.attachmentsDir, { recursive: true });
  await fs.mkdir(paths.keysDir, { recursive: true });
  await fs.mkdir(paths.sessionsDir, { recursive: true });

  // Write config
  const config = {
    version: 1,
    createdAt: new Date().toISOString(),
    sessionTtlMinutes: 15,
  };
  await fs.writeFile(paths.configPath, JSON.stringify(config, null, 2), "utf8");

  // Write a fake wrapped identity (at least 32 bytes)
  await fs.writeFile(
    paths.wrappedIdentityPath,
    Buffer.alloc(64, 0xab),
  );

  // Write a real SQLite database with schema
  const db = openDatabase(paths);
  try {
    runMigrations(db);
    // Insert a sample entry so there's data to back up
    createEntryRecord(db, {
      id: "test-entry-1",
      title: "Test Entry",
      category: "note",
      contentPath: "test-entry-1.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  } finally {
    db.close();
  }

  // Create a fake encrypted entry file
  await fs.writeFile(
    path.join(paths.entriesDir, "test-entry-1.age"),
    "fake-encrypted-content",
  );

  // Create a fake encrypted attachment
  await fs.writeFile(
    path.join(paths.attachmentsDir, "att-001.age"),
    "fake-attachment-data",
  );

  return paths;
}

interface ManifestFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

interface Manifest {
  version: number;
  createdAt: string;
  vaultVersion: number;
  totalFiles: number;
  files: ManifestFile[];
}

describe("backup service (createBackup)", () => {
  let vaultRoot: string;
  let backupDir: string;

  afterEach(async () => {
    if (vaultRoot) {
      await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
    }
    if (backupDir) {
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("creates a complete backup with manifest", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-vault-"));
    const paths = await setupVault(vaultRoot);
    backupDir = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-out-")),
      "backup",
    );

    await createBackup(paths, { outputDir: backupDir });

    // Verify manifest exists and is valid
    const manifestRaw = await fs.readFile(
      path.join(backupDir, "manifest.json"),
      "utf8",
    );
    const manifest: Manifest = JSON.parse(manifestRaw);

    expect(manifest.version).toBe(1);
    expect(manifest.vaultVersion).toBe(1);
    expect(typeof manifest.createdAt).toBe("string");
    expect(manifest.totalFiles).toBeGreaterThan(0);
    expect(manifest.files).toHaveLength(manifest.totalFiles);

    // Verify core files are in manifest
    const pathsInManifest = manifest.files.map((f) => f.path);
    expect(pathsInManifest).toContain("config.json");
    expect(pathsInManifest).toContain("db.sqlite");
    expect(pathsInManifest).toContain("keys/identity.age.enc");
    expect(pathsInManifest).toContain("vault/entries/test-entry-1.age");
    expect(pathsInManifest).toContain("vault/attachments/att-001.age");
  });

  it("every file in manifest has a valid SHA-256 digest and correct size", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-vault-"));
    const paths = await setupVault(vaultRoot);
    backupDir = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-out-")),
      "backup",
    );

    await createBackup(paths, { outputDir: backupDir });

    const manifestRaw = await fs.readFile(
      path.join(backupDir, "manifest.json"),
      "utf8",
    );
    const manifest: Manifest = JSON.parse(manifestRaw);

    for (const file of manifest.files) {
      // File exists
      const filePath = path.join(backupDir, file.path);
      const stat = await fs.stat(filePath);
      expect(stat.size).toBe(file.sizeBytes);

      // SHA-256 is a 64-char hex string
      expect(file.sha256).toHaveLength(64);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("captures the same logical database contents and config", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-vault-"));
    const paths = await setupVault(vaultRoot);
    backupDir = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-out-")),
      "backup",
    );

    await createBackup(paths, { outputDir: backupDir });

    const originalDb = openDatabase(paths);
    const backupDb = openDatabase({
      ...paths,
      dbPath: path.join(backupDir, "db.sqlite"),
    });
    try {
      const originalRows = originalDb
        .prepare("SELECT id, title, category, content_path FROM entries ORDER BY id")
        .all();
      const backupRows = backupDb
        .prepare("SELECT id, title, category, content_path FROM entries ORDER BY id")
        .all();
      expect(backupRows).toEqual(originalRows);
    } finally {
      originalDb.close();
      backupDb.close();
    }

    const originalConfig = await fs.readFile(paths.configPath);
    const backupConfig = await fs.readFile(path.join(backupDir, "config.json"));
    expect(backupConfig).toEqual(originalConfig);
  });

  it("fails if vault is not initialized", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-vault-"));
    const paths = tempPaths(vaultRoot); // no setupVault — empty dirs
    backupDir = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-out-")),
      "backup",
    );

    await expect(createBackup(paths, { outputDir: backupDir })).rejects.toThrow(
      /not initialized/,
    );
  });

  it("fails if output directory already exists", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-vault-"));
    const paths = await setupVault(vaultRoot);
    backupDir = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-out-")),
      "backup",
    );
    // Pre-create the output dir
    await fs.mkdir(backupDir, { recursive: true });

    await expect(createBackup(paths, { outputDir: backupDir })).rejects.toThrow(
      /already exists/,
    );
  });

  it("manifest does not contain plaintext entry content", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-vault-"));
    const paths = await setupVault(vaultRoot);
    backupDir = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-out-")),
      "backup",
    );

    await createBackup(paths, { outputDir: backupDir });

    const manifestRaw = await fs.readFile(
      path.join(backupDir, "manifest.json"),
      "utf8",
    );

    // The manifest should only contain metadata (path, sha256, sizeBytes)
    // It should never contain plaintext content
    expect(manifestRaw).not.toContain("fake-encrypted-content");
    expect(manifestRaw).not.toContain("Test Entry"); // title is metadata, but content is not
  });

  it("handles vault with no entry or attachment files", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-vault-"));
    const paths = await setupVault(vaultRoot);

    // Remove entry and attachment files
    await fs.rm(path.join(paths.entriesDir, "test-entry-1.age")).catch(() => {});
    await fs.rm(path.join(paths.attachmentsDir, "att-001.age")).catch(() => {});

    backupDir = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-backup-out-")),
      "backup",
    );

    await createBackup(paths, { outputDir: backupDir });

    const manifestRaw = await fs.readFile(
      path.join(backupDir, "manifest.json"),
      "utf8",
    );
    const manifest: Manifest = JSON.parse(manifestRaw);

    // Only core files: config, db, identity
    expect(manifest.totalFiles).toBe(3);
    const filePaths = manifest.files.map((f) => f.path);
    expect(filePaths).toContain("config.json");
    expect(filePaths).toContain("db.sqlite");
    expect(filePaths).toContain("keys/identity.age.enc");
  });
});

describe("backup service (verifyBackup)", () => {
  let vaultRoot: string;
  let backupDir: string;

  /** Create a valid backup to test against. */
  async function createTestBackup(): Promise<string> {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-verify-vault-"));
    const paths = await setupVault(vaultRoot);
    backupDir = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-verify-out-")),
      "backup",
    );
    await createBackup(paths, { outputDir: backupDir });
    return backupDir;
  }

  afterEach(async () => {
    if (vaultRoot) {
      await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
    }
    if (backupDir) {
      await fs.rm(path.dirname(backupDir), { recursive: true, force: true }).catch(() => {});
    }
  });

  it("passes for a freshly created backup", async () => {
    const dir = await createTestBackup();
    const result = await verifyBackup(dir);

    expect(result.totalFiles).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it("reports missing manifest", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-verify-empty-"));
    backupDir = tmp;
    try {
      const result = await verifyBackup(tmp);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("manifest.json");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("reports a missing file listed in manifest", async () => {
    const dir = await createTestBackup();

    // Delete one entry file
    await fs.rm(path.join(dir, "vault", "entries", "test-entry-1.age"));

    const result = await verifyBackup(dir);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes("missing file"))).toBe(true);
  });

  it("reports digest mismatch when a file is corrupted", async () => {
    const dir = await createTestBackup();

    // Corrupt the config file
    await fs.writeFile(
      path.join(dir, "config.json"),
      "corrupted-data",
      "utf8",
    );

    const result = await verifyBackup(dir);
    expect(result.errors.some((e) => e.includes("digest mismatch"))).toBe(true);
  });

  it("reports size mismatch", async () => {
    const dir = await createTestBackup();

    // Append bytes to the db file to change size but also break digest
    const dbPath = path.join(dir, "db.sqlite");
    const original = await fs.readFile(dbPath);
    await fs.writeFile(dbPath, Buffer.concat([original, Buffer.from("extra")]));

    const result = await verifyBackup(dir);
    const dbErrors = result.errors.filter(
      (e) => e.includes("db.sqlite") && e.includes("mismatch"),
    );
    expect(dbErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("reports invalid manifest JSON", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-verify-badjson-"));
    backupDir = tmp;
    try {
      await fs.writeFile(
        path.join(tmp, "manifest.json"),
        "this is not json{{{",
        "utf8",
      );
      const result = await verifyBackup(tmp);
      expect(result.errors[0]).toContain("manifest.json");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rejects manifest paths that escape the backup directory", async () => {
    const dir = await createTestBackup();
    const manifestPath = path.join(dir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
    manifest.files[0].path = "../outside.txt";
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const result = await verifyBackup(dir);
    expect(result.errors.some((e) => e.includes("invalid manifest path"))).toBe(true);
  });

  it("reports unexpected extra files in the backup", async () => {
    const dir = await createTestBackup();
    await fs.writeFile(path.join(dir, "vault", "entries", "unexpected.age"), "x", "utf8");

    const result = await verifyBackup(dir);
    expect(result.errors).toContain("unexpected file in backup: vault/entries/unexpected.age");
  });

  it("reports missing required manifest entries", async () => {
    const dir = await createTestBackup();
    const manifestPath = path.join(dir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
    manifest.files = manifest.files.filter((file) => file.path !== "db.sqlite");
    manifest.totalFiles = manifest.files.length;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const result = await verifyBackup(dir);
    expect(result.errors).toContain("missing required manifest entry: db.sqlite");
  });
});
