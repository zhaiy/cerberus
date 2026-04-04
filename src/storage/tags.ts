import type Database from "better-sqlite3";

import type { TagRow } from "../core/types.js";

// ── Upsert (create if not exists, return existing if duplicate) ──

export function ensureTag(db: Database.Database, name: string): TagRow {
  db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(name);
  const row = db.prepare("SELECT * FROM tags WHERE name = ?").get(name) as Record<string, unknown>;
  return { id: row.id as number, name: row.name as string };
}

// ── Read ──

export function getTagById(
  db: Database.Database,
  id: number,
): TagRow | undefined {
  const row = db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? { id: row.id as number, name: row.name as string } : undefined;
}

export function getTagByName(
  db: Database.Database,
  name: string,
): TagRow | undefined {
  const row = db.prepare("SELECT * FROM tags WHERE name = ?").get(name) as
    | Record<string, unknown>
    | undefined;
  return row ? { id: row.id as number, name: row.name as string } : undefined;
}

export function listAllTags(db: Database.Database): TagRow[] {
  const rows = db
    .prepare("SELECT * FROM tags ORDER BY name")
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
}

// ── Entry-tag relations ──

export function attachTagsToEntry(
  db: Database.Database,
  entryId: string,
  tagIds: number[],
): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
  );
  for (const tagId of tagIds) {
    stmt.run(entryId, tagId);
  }
}

export function detachTagsFromEntry(
  db: Database.Database,
  entryId: string,
  tagIds?: number[],
): void {
  if (tagIds && tagIds.length > 0) {
    const placeholders = tagIds.map(() => "?").join(", ");
    db.prepare(
      `DELETE FROM entry_tags WHERE entry_id = ? AND tag_id IN (${placeholders})`,
    ).run(entryId, ...tagIds);
  } else {
    db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").run(entryId);
  }
}

export function getTagsForEntry(
  db: Database.Database,
  entryId: string,
): TagRow[] {
  const rows = db
    .prepare(
      `SELECT t.* FROM tags t
       JOIN entry_tags et ON et.tag_id = t.id
       WHERE et.entry_id = ?
       ORDER BY t.name`,
    )
    .all(entryId) as Record<string, unknown>[];
  return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
}
