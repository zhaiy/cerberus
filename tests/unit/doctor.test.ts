import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AppPaths } from "../../src/core/types.js";
import { openDatabase, runMigrations } from "../../src/storage/db.js";
import { createEntryRecord } from "../../src/storage/entries.js";
import {
  applyCleanup,
  formatDoctorCheckJson,
  planCleanupFromCheck,
  runDoctorCheck,
} from "../../src/services/doctor-service.js";

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

async function minimalVault(root: string): Promise<AppPaths> {
  const paths = tempPaths(root);
  await fs.mkdir(paths.entriesDir, { recursive: true });
  await fs.mkdir(paths.attachmentsDir, { recursive: true });
  await fs.mkdir(paths.keysDir, { recursive: true });
  await fs.mkdir(paths.sessionsDir, { recursive: true });
  await fs.writeFile(
    paths.configPath,
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      sessionTtlMinutes: 15,
    }),
    "utf8",
  );
  await fs.writeFile(paths.wrappedIdentityPath, Buffer.alloc(64, 0xcd));
  const db = openDatabase(paths);
  try {
    runMigrations(db);
  } finally {
    db.close();
  }
  return paths;
}

async function softDeleteEntryRow(paths: AppPaths, id: string): Promise<void> {
  const db = openDatabase(paths);
  try {
    db.prepare("UPDATE entries SET deleted_at = ? WHERE id = ?").run(
      "2026-04-05T00:00:00.000Z",
      id,
    );
  } finally {
    db.close();
  }
}

describe("runDoctorCheck", () => {
  let vaultRoot: string;

  afterEach(async () => {
    if (vaultRoot) {
      await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("reports orphan entry ciphertext files", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-doc-orph-"));
    const paths = await minimalVault(vaultRoot);
    await fs.writeFile(
      path.join(paths.entriesDir, "orphan.age"),
      "cipher",
      "utf8",
    );

    const result = await runDoctorCheck(paths);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.kind === "orphan_entry_file"),
    ).toBe(true);
  });

  it("reports missing ciphertext for an entry row", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-doc-miss-"));
    const paths = await minimalVault(vaultRoot);
    const db = openDatabase(paths);
    try {
      createEntryRecord(db, {
        id: "e1",
        title: "T",
        category: "note",
        contentPath: "missing.age",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      db.close();
    }

    const result = await runDoctorCheck(paths);
    expect(result.ok).toBe(false);
    const miss = result.issues.find((i) => i.kind === "entry_missing_ciphertext");
    expect(miss).toBeDefined();
    expect(miss!.entryId).toBe("e1");
  });

  it("JSON output is stable and includes issue kinds", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-doc-json-"));
    const paths = await minimalVault(vaultRoot);
    const result = await runDoctorCheck(paths);
    const json = JSON.parse(formatDoctorCheckJson(result));
    expect(json).toHaveProperty("ok");
    expect(json).toHaveProperty("issues");
    expect(Array.isArray(json.issues)).toBe(true);
  });

  it("does not mutate the database while checking", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-doc-readonly-"));
    const paths = tempPaths(vaultRoot);
    await fs.mkdir(paths.entriesDir, { recursive: true });
    await fs.mkdir(paths.attachmentsDir, { recursive: true });
    await fs.mkdir(paths.keysDir, { recursive: true });
    await fs.mkdir(paths.sessionsDir, { recursive: true });
    await fs.writeFile(
      paths.configPath,
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        sessionTtlMinutes: 15,
      }),
      "utf8",
    );
    await fs.writeFile(paths.wrappedIdentityPath, Buffer.alloc(64, 0xcd));
    await fs.writeFile(paths.dbPath, "");

    const before = await fs.stat(paths.dbPath);
    const result = await runDoctorCheck(paths);
    const after = await fs.stat(paths.dbPath);

    expect(result.issues.some((i) => i.kind === "database_schema_invalid")).toBe(true);
    expect(after.size).toBe(before.size);
  });

  it("does not flag ciphertext retained for a soft-deleted entry as orphan", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-doc-softdel-"));
    const paths = await minimalVault(vaultRoot);
    const ciphertextName = "kept.age";
    const db = openDatabase(paths);
    try {
      createEntryRecord(db, {
        id: "e-soft",
        title: "Deleted but retained",
        category: "note",
        contentPath: ciphertextName,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
    await softDeleteEntryRow(paths, "e-soft");
    await fs.writeFile(path.join(paths.entriesDir, ciphertextName), "cipher", "utf8");

    const result = await runDoctorCheck(paths);

    expect(result.issues.some((i) => i.kind === "orphan_entry_file")).toBe(false);
  });
});

describe("doctor cleanup plan / apply", () => {
  let vaultRoot: string;

  afterEach(async () => {
    if (vaultRoot) {
      await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("apply removes an orphan entry file", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-doc-clean-"));
    const paths = await minimalVault(vaultRoot);
    const orphanPath = path.join(paths.entriesDir, "orphan.age");
    await fs.writeFile(orphanPath, "x", "utf8");

    const check = await runDoctorCheck(paths);
    const plan = planCleanupFromCheck(paths, check);
    expect(plan.items.length).toBe(1);
    expect(plan.items[0].action).toBe("delete_orphan_entry_file");

    await applyCleanup(paths, plan);
    await expect(fs.access(orphanPath)).rejects.toBeDefined();

    const check2 = await runDoctorCheck(paths);
    expect(
      check2.issues.filter((i) => i.kind === "orphan_entry_file"),
    ).toHaveLength(0);
  });

  it("cleanup plan excludes rows with missing ciphertext", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-doc-safeplan-"));
    const paths = await minimalVault(vaultRoot);
    const db = openDatabase(paths);
    try {
      createEntryRecord(db, {
        id: "e1",
        title: "Broken ref",
        category: "note",
        contentPath: "missing.age",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      db.close();
    }

    const check = await runDoctorCheck(paths);
    expect(check.issues.some((i) => i.kind === "entry_missing_ciphertext")).toBe(true);

    const plan = planCleanupFromCheck(paths, check);
    expect(plan.items).toEqual([]);
  });
});
