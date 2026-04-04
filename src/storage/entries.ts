import type Database from "better-sqlite3";

import type { EntryCategory, EntryRow } from "../core/types.js";

// ── Column mapping ──

function rowToEntryRow(row: Record<string, unknown>): EntryRow {
  return {
    id: row.id as string,
    title: row.title as string,
    category: row.category as EntryCategory,
    contentPath: row.content_path as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string | null) ?? null,
  };
}

// ── Create ──

export function createEntryRecord(
  db: Database.Database,
  entry: {
    id: string;
    title: string;
    category: EntryCategory;
    contentPath: string;
    createdAt: string;
    updatedAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO entries (id, title, category, content_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.title,
    entry.category,
    entry.contentPath,
    entry.createdAt,
    entry.updatedAt,
  );
}

// ── Read ──

export function getEntryById(
  db: Database.Database,
  id: string,
): EntryRow | undefined {
  const row = db
    .prepare("SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToEntryRow(row) : undefined;
}

// ── List ──

export interface ListEntriesOptions {
  category?: EntryCategory;
  tagId?: number;
  limit?: number;
  offset?: number;
}

export function listEntryRecords(
  db: Database.Database,
  options?: ListEntriesOptions,
): EntryRow[] {
  const clauses: string[] = ["e.deleted_at IS NULL"];
  const params: unknown[] = [];

  if (options?.category) {
    clauses.push("e.category = ?");
    params.push(options.category);
  }

  if (options?.tagId !== undefined) {
    clauses.push(
      "e.id IN (SELECT entry_id FROM entry_tags WHERE tag_id = ?)",
    );
    params.push(options.tagId);
  }

  const where = clauses.join(" AND ");
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT e.* FROM entries e
       WHERE ${where}
       ORDER BY e.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(rowToEntryRow);
}

// ── Update ──

export function updateEntryRecord(
  db: Database.Database,
  id: string,
  updates: {
    title?: string;
    category?: EntryCategory;
    contentPath?: string;
    updatedAt: string;
  },
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    params.push(updates.title);
  }
  if (updates.category !== undefined) {
    sets.push("category = ?");
    params.push(updates.category);
  }
  if (updates.contentPath !== undefined) {
    sets.push("content_path = ?");
    params.push(updates.contentPath);
  }
  sets.push("updated_at = ?");
  params.push(updates.updatedAt);

  params.push(id);

  const result = db
    .prepare(
      `UPDATE entries SET ${sets.join(", ")}
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(...params);

  return result.changes > 0;
}

// ── Soft delete ──

export function softDeleteEntry(
  db: Database.Database,
  id: string,
  deletedAt: string,
): boolean {
  const result = db
    .prepare("UPDATE entries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
    .run(deletedAt, id);
  return result.changes > 0;
}

// ── Search ──

export function searchEntries(
  db: Database.Database,
  query: string,
  options?: { limit?: number; offset?: number },
): EntryRow[] {
  const like = `%${query}%`;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT e.* FROM entries e
       WHERE e.deleted_at IS NULL
         AND (e.title LIKE ? OR e.id IN (
           SELECT et.entry_id FROM entry_tags et
           JOIN tags t ON t.id = et.tag_id
           WHERE t.name LIKE ?
         ))
       ORDER BY e.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(like, like, limit, offset) as Record<string, unknown>[];

  return rows.map(rowToEntryRow);
}

export function searchEntriesByTitle(
  db: Database.Database,
  query: string,
  options?: { limit?: number; offset?: number },
): EntryRow[] {
  const like = `%${query}%`;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT e.* FROM entries e
       WHERE e.deleted_at IS NULL
         AND e.title LIKE ?
       ORDER BY e.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(like, limit, offset) as Record<string, unknown>[];

  return rows.map(rowToEntryRow);
}

export function searchEntriesByTag(
  db: Database.Database,
  query: string,
  options?: { limit?: number; offset?: number },
): EntryRow[] {
  const like = `%${query}%`;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT e.* FROM entries e
       WHERE e.deleted_at IS NULL
         AND e.id IN (
           SELECT et.entry_id FROM entry_tags et
           JOIN tags t ON t.id = et.tag_id
           WHERE t.name LIKE ?
         )
       ORDER BY e.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(like, limit, offset) as Record<string, unknown>[];

  return rows.map(rowToEntryRow);
}
