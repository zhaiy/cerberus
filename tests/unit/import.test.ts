import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AppPaths } from "../../src/core/types.js";
import { openDatabase, runMigrations } from "../../src/storage/db.js";
import {
  importPlaintextEntries,
  parseExportedMarkdownFile,
} from "../../src/services/import-service.js";

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

describe("import-service (parseExportedMarkdownFile)", () => {
  it("parses Cerberus markdown export shape", () => {
    const md = [
      "# Hello",
      "",
      "- **ID:** old-id",
      "- **Category:** note",
      "- **Tags:** a, b",
      "- **Created:** 2026-01-01T00:00:00.000Z",
      "- **Updated:** 2026-01-02T00:00:00.000Z",
      "",
      "Body line",
    ].join("\n");
    const p = parseExportedMarkdownFile(md);
    expect(p).not.toBeNull();
    expect(p!.title).toBe("Hello");
    expect(p!.category).toBe("note");
    expect(p!.tags).toEqual(["a", "b"]);
    expect(p!.content.trim()).toBe("Body line");
  });
});

describe("importPlaintextEntries", () => {
  let vaultRoot: string;
  let importDir: string;

  afterEach(async () => {
    if (vaultRoot) {
      await fs.rm(vaultRoot, { recursive: true, force: true }).catch(() => {});
    }
    if (importDir) {
      await fs.rm(importDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("imports JSON export and creates new encrypted entries", async () => {
    const { generateIdentity } = await import("../../src/crypto/identity.js");
    const { withVaultWriteLock } = await import("../../src/core/vault-lock.js");
    const { createEntryWithLockHeld } = await import(
      "../../src/services/vault-service.js"
    );

    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-import-json-"));
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
    await fs.writeFile(paths.wrappedIdentityPath, Buffer.alloc(64, 1));

    const db = openDatabase(paths);
    try {
      runMigrations(db);
    } finally {
      db.close();
    }

    const identityPlain = await generateIdentity();
    await withVaultWriteLock(paths, async () => {
      await createEntryWithLockHeld(paths, identityPlain, {
        title: "Existing",
        category: "note",
        content: "old",
        tags: [],
      });
    });

    importDir = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-import-in-"));
    await fs.writeFile(
      path.join(importDir, "entries.json"),
      JSON.stringify(
        [
          {
            id: "export-1",
            title: "Imported",
            category: "diary",
            tags: ["x"],
            content: "hello import",
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-02T00:00:00.000Z",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const stats = await importPlaintextEntries(paths, identityPlain, {
      format: "json",
      inputDir: importDir,
    });

    expect(stats.success).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(stats.conflict).toBe(0);

    const db2 = openDatabase(paths);
    try {
      const rows = db2
        .prepare(
          "SELECT id, title, category FROM entries WHERE deleted_at IS NULL ORDER BY title",
        )
        .all() as { id: string; title: string; category: string }[];
      expect(rows.length).toBe(2);
      const imported = rows.find((r) => r.title === "Imported");
      expect(imported).toBeDefined();
      expect(imported!.category).toBe("diary");

      const row = db2
        .prepare("SELECT content_path FROM entries WHERE title = ?")
        .get("Imported") as { content_path: string };
      const cipher = await fs.readFile(
        path.join(paths.entriesDir, row.content_path),
      );
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-id-tmp-"));
      const idPath = path.join(tmpDir, "id");
      await fs.writeFile(idPath, identityPlain, { mode: 0o600 });
      const { decryptBuffer } = await import("../../src/crypto/age.js");
      const plain = await decryptBuffer(cipher, idPath);
      await fs.rm(tmpDir, { recursive: true, force: true });
      expect(plain.toString("utf8")).toBe("hello import");
    } finally {
      db2.close();
    }

    identityPlain.fill(0);
  });

  it("counts duplicate source ids in JSON as conflict", async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-import-dup-"));
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
    await fs.writeFile(paths.wrappedIdentityPath, Buffer.alloc(64, 1));
    const db = openDatabase(paths);
    try {
      runMigrations(db);
    } finally {
      db.close();
    }

    const { generateIdentity } = await import("../../src/crypto/identity.js");
    const identityPlain = await generateIdentity();

    importDir = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-import-dup-in-"));
    await fs.writeFile(
      path.join(importDir, "entries.json"),
      JSON.stringify(
        [
          {
            id: "same",
            title: "A",
            category: "note",
            tags: [],
            content: "one",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "same",
            title: "B",
            category: "note",
            tags: [],
            content: "two",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const stats = await importPlaintextEntries(paths, identityPlain, {
      format: "json",
      inputDir: importDir,
    });

    expect(stats.success).toBe(1);
    expect(stats.conflict).toBe(1);

    identityPlain.fill(0);
  });
});
