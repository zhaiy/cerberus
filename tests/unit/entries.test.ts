import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import { openDatabase, runMigrations } from "../../src/storage/db.js";
import {
  createEntryRecord,
  getEntryById,
  listEntryRecords,
  searchEntries,
  searchEntriesByTag,
  searchEntriesByTitle,
  softDeleteEntry,
  updateEntryRecord,
} from "../../src/storage/entries.js";
import {
  attachTagsToEntry,
  ensureTag,
  getTagsForEntry,
} from "../../src/storage/tags.js";
import type { AppPaths } from "../../src/core/types.js";

function memoryPaths(): AppPaths {
  return {
    homeDir: "/tmp",
    appDir: "/tmp",
    vaultDir: "/tmp",
    entriesDir: "/tmp/e",
    attachmentsDir: "/tmp/a",
    configPath: "/tmp/c",
    dbPath: ":memory:",
    keysDir: "/tmp/k",
    wrappedIdentityPath: "/tmp/k/id",
    sessionsDir: "/tmp/s",
  };
}

function openMemoryDb(): Database.Database {
  const db = openDatabase(memoryPaths());
  runMigrations(db);
  return db;
}

describe("entries repository (SQLite :memory:)", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("createEntryRecord and getEntryById round-trip", () => {
    db = openMemoryDb();
    createEntryRecord(db, {
      id: "e1",
      title: "Hello",
      category: "note",
      contentPath: "e1.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const row = getEntryById(db, "e1");
    expect(row).toEqual({
      id: "e1",
      title: "Hello",
      category: "note",
      contentPath: "e1.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    });
  });

  it("getEntryById returns undefined for soft-deleted rows", () => {
    db = openMemoryDb();
    createEntryRecord(db, {
      id: "gone",
      title: "X",
      category: "secret",
      contentPath: "gone.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    softDeleteEntry(db, "gone", "2026-02-01T00:00:00.000Z");
    expect(getEntryById(db, "gone")).toBeUndefined();
  });

  it("listEntryRecords orders by updated_at descending", () => {
    db = openMemoryDb();
    createEntryRecord(db, {
      id: "a",
      title: "Old",
      category: "note",
      contentPath: "a.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    createEntryRecord(db, {
      id: "b",
      title: "New",
      category: "note",
      contentPath: "b.age",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    const rows = listEntryRecords(db);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("listEntryRecords filters by category", () => {
    db = openMemoryDb();
    createEntryRecord(db, {
      id: "n1",
      title: "N",
      category: "note",
      contentPath: "n1.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    createEntryRecord(db, {
      id: "d1",
      title: "D",
      category: "diary",
      contentPath: "d1.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const notes = listEntryRecords(db, { category: "note" });
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe("n1");
  });

  it("updateEntryRecord updates selected fields", () => {
    db = openMemoryDb();
    createEntryRecord(db, {
      id: "u1",
      title: "T0",
      category: "note",
      contentPath: "u1.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const ok = updateEntryRecord(db, "u1", {
      title: "T1",
      updatedAt: "2026-06-01T12:00:00.000Z",
    });
    expect(ok).toBe(true);
    const row = getEntryById(db, "u1");
    expect(row?.title).toBe("T1");
    expect(row?.updatedAt).toBe("2026-06-01T12:00:00.000Z");
  });

  it("tags: ensureTag, attachTagsToEntry, listEntryRecords by tagId, getTagsForEntry", () => {
    db = openMemoryDb();
    createEntryRecord(db, {
      id: "ent",
      title: "Tagged",
      category: "collection",
      contentPath: "ent.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const tag = ensureTag(db, "work");
    attachTagsToEntry(db, "ent", [tag.id]);
    const byTag = listEntryRecords(db, { tagId: tag.id });
    expect(byTag).toHaveLength(1);
    expect(byTag[0].id).toBe("ent");
    const tags = getTagsForEntry(db, "ent");
    expect(tags.map((t) => t.name)).toEqual(["work"]);
  });

  it("searchEntries matches title substring", () => {
    db = openMemoryDb();
    createEntryRecord(db, {
      id: "s1",
      title: "Alpha project",
      category: "note",
      contentPath: "s1.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const hits = searchEntries(db, "project");
    expect(hits.map((h) => h.id)).toEqual(["s1"]);
  });

  it("searchEntriesByTitle only matches titles", () => {
    db = openMemoryDb();
    createEntryRecord(db, {
      id: "title-hit",
      title: "Alpha project",
      category: "note",
      contentPath: "title-hit.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    createEntryRecord(db, {
      id: "tag-hit",
      title: "Completely different",
      category: "note",
      contentPath: "tag-hit.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const tag = ensureTag(db, "project");
    attachTagsToEntry(db, "tag-hit", [tag.id]);

    const hits = searchEntriesByTitle(db, "project");
    expect(hits.map((h) => h.id)).toEqual(["title-hit"]);
  });

  it("searchEntriesByTag only matches tags", () => {
    db = openMemoryDb();
    createEntryRecord(db, {
      id: "title-only",
      title: "Project notes",
      category: "note",
      contentPath: "title-only.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    createEntryRecord(db, {
      id: "tag-only",
      title: "Different title",
      category: "note",
      contentPath: "tag-only.age",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const tag = ensureTag(db, "project");
    attachTagsToEntry(db, "tag-only", [tag.id]);

    const hits = searchEntriesByTag(db, "project");
    expect(hits.map((h) => h.id)).toEqual(["tag-only"]);
  });
});
