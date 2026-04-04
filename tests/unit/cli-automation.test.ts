import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { closeSession, getActiveSession, openSession } from "../../src/crypto/session.js";
import type { AppPaths, EntryCategory } from "../../src/core/types.js";
import { openDatabase, runMigrations } from "../../src/storage/db.js";
import { createEntryRecord } from "../../src/storage/entries.js";
import { ensureTag, attachTagsToEntry } from "../../src/storage/tags.js";
import { entriesToJsonOutput } from "../../src/commands/list.js";

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

async function setupVault(root: string): Promise<AppPaths> {
  const paths = tempPaths(root);
  await fs.mkdir(paths.entriesDir, { recursive: true });
  await fs.mkdir(paths.sessionsDir, { recursive: true });

  const db = openDatabase(paths);
  try {
    runMigrations(db);
  } finally {
    db.close();
  }

  return paths;
}

function seedEntry(
  paths: AppPaths,
  opts: {
    id: string;
    title: string;
    category: EntryCategory;
    tags?: string[];
  },
): void {
  const now = "2026-01-15T10:30:00.000Z";
  const db = openDatabase(paths);
  try {
    createEntryRecord(db, {
      id: opts.id,
      title: opts.title,
      category: opts.category,
      contentPath: `${opts.id}.age`,
      createdAt: now,
      updatedAt: now,
    });
    if (opts.tags?.length) {
      const tagIds = opts.tags.map((t) => ensureTag(db, t).id);
      attachTagsToEntry(db, opts.id, tagIds);
    }
  } finally {
    db.close();
  }
}

describe("lock command (session cleanup)", () => {
  let root: string;
  let paths: AppPaths;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("removes active session", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-lock-"));
    paths = await setupVault(root);

    // Create a session
    await openSession(paths, Buffer.from("test-identity-data"), 15);
    const session = await getActiveSession(paths);
    expect(session).not.toBeNull();

    // Lock
    await closeSession(paths);

    // Verify gone
    const after = await getActiveSession(paths);
    expect(after).toBeNull();
  });

  it("is a no-op when already locked", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-lock-"));
    paths = await setupVault(root);

    // No session exists
    const before = await getActiveSession(paths);
    expect(before).toBeNull();

    // closeSession should not throw
    await expect(closeSession(paths)).resolves.toBeUndefined();
  });
});

describe("entriesToJsonOutput", () => {
  let root: string;
  let paths: AppPaths;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("produces stable JSON with id, title, category, tags, timestamps", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-json-"));
    paths = await setupVault(root);

    seedEntry(paths, {
      id: "e1",
      title: "First Note",
      category: "note",
      tags: ["work"],
    });
    seedEntry(paths, {
      id: "e2",
      title: "Secret Diary",
      category: "diary",
      tags: ["personal", "travel"],
    });

    const db = openDatabase(paths);
    try {
      // Import listEntryRecords to get actual rows
      const { listEntryRecords } = await import("../../src/storage/entries.js");
      const entries = listEntryRecords(db);
      const json = entriesToJsonOutput(db, entries);

      expect(json).toHaveLength(2);

      // Verify structure
      const first = json.find((e) => e.id === "e1")!;
      expect(first).toEqual({
        id: "e1",
        title: "First Note",
        category: "note",
        tags: ["work"],
        createdAt: "2026-01-15T10:30:00.000Z",
        updatedAt: "2026-01-15T10:30:00.000Z",
      });

      const second = json.find((e) => e.id === "e2")!;
      expect(second.tags).toEqual(["personal", "travel"]);
    } finally {
      db.close();
    }
  });

  it("round-trips through JSON.parse without data loss", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-json-"));
    paths = await setupVault(root);

    seedEntry(paths, {
      id: "abc",
      title: "Round Trip",
      category: "secret",
    });

    const db = openDatabase(paths);
    try {
      const { listEntryRecords } = await import("../../src/storage/entries.js");
      const entries = listEntryRecords(db);
      const json = entriesToJsonOutput(db, entries);
      const serialized = JSON.stringify(json);
      const parsed = JSON.parse(serialized);

      expect(parsed).toEqual(json);
    } finally {
      db.close();
    }
  });

  it("entries with no tags produce empty array", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-json-"));
    paths = await setupVault(root);

    seedEntry(paths, {
      id: "no-tags",
      title: "Untagged",
      category: "note",
    });

    const db = openDatabase(paths);
    try {
      const { listEntryRecords } = await import("../../src/storage/entries.js");
      const entries = listEntryRecords(db);
      const json = entriesToJsonOutput(db, entries);

      expect(json[0].tags).toEqual([]);
    } finally {
      db.close();
    }
  });
});
