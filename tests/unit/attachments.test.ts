import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import { openDatabase, runMigrations } from "../../src/storage/db.js";
import {
  createAttachmentRecord,
  getAttachmentById,
  listAttachmentsForEntry,
  deleteAttachment,
} from "../../src/storage/attachments.js";
import { createEntryRecord } from "../../src/storage/entries.js";
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

function seedEntry(db: Database.Database, id = "e1"): void {
  createEntryRecord(db, {
    id,
    title: "Test",
    category: "note",
    contentPath: `${id}.age`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("attachments repository (SQLite :memory:)", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("createAttachmentRecord and getAttachmentById round-trip", () => {
    db = openMemoryDb();
    seedEntry(db);
    createAttachmentRecord(db, {
      id: "a1",
      entryId: "e1",
      originalName: "photo.jpg",
      mimeType: "image/jpeg",
      encryptedPath: "a1.age",
      sizeBytes: 4096,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const row = getAttachmentById(db, "a1");
    expect(row).toEqual({
      id: "a1",
      entryId: "e1",
      originalName: "photo.jpg",
      mimeType: "image/jpeg",
      encryptedPath: "a1.age",
      sizeBytes: 4096,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("getAttachmentById returns undefined for missing id", () => {
    db = openMemoryDb();
    expect(getAttachmentById(db, "nope")).toBeUndefined();
  });

  it("listAttachmentsForEntry returns attachments in order", () => {
    db = openMemoryDb();
    seedEntry(db);
    createAttachmentRecord(db, {
      id: "a1",
      entryId: "e1",
      originalName: "first.txt",
      mimeType: null,
      encryptedPath: "a1.age",
      sizeBytes: 100,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    createAttachmentRecord(db, {
      id: "a2",
      entryId: "e1",
      originalName: "second.txt",
      mimeType: null,
      encryptedPath: "a2.age",
      sizeBytes: 200,
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const list = listAttachmentsForEntry(db, "e1");
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("a1");
    expect(list[1].id).toBe("a2");
  });

  it("listAttachmentsForEntry returns empty for entry with no attachments", () => {
    db = openMemoryDb();
    seedEntry(db);
    expect(listAttachmentsForEntry(db, "e1")).toEqual([]);
  });

  it("deleteAttachment removes the record", () => {
    db = openMemoryDb();
    seedEntry(db);
    createAttachmentRecord(db, {
      id: "a1",
      entryId: "e1",
      originalName: "gone.pdf",
      mimeType: "application/pdf",
      encryptedPath: "a1.age",
      sizeBytes: 999,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(deleteAttachment(db, "a1")).toBe(true);
    expect(getAttachmentById(db, "a1")).toBeUndefined();
  });

  it("deleteAttachment returns false for missing id", () => {
    db = openMemoryDb();
    expect(deleteAttachment(db, "nope")).toBe(false);
  });
});
