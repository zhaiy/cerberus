import type Database from "better-sqlite3";

import type { AttachmentRow } from "../core/types.js";

function rowToAttachmentRow(row: Record<string, unknown>): AttachmentRow {
  return {
    id: row.id as string,
    entryId: row.entry_id as string,
    originalName: row.original_name as string,
    mimeType: (row.mime_type as string | null) ?? null,
    encryptedPath: row.encrypted_path as string,
    sizeBytes: row.size_bytes as number,
    createdAt: row.created_at as string,
  };
}

// ── Create ──

export function createAttachmentRecord(
  db: Database.Database,
  attachment: {
    id: string;
    entryId: string;
    originalName: string;
    mimeType: string | null;
    encryptedPath: string;
    sizeBytes: number;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO attachments (id, entry_id, original_name, mime_type, encrypted_path, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    attachment.id,
    attachment.entryId,
    attachment.originalName,
    attachment.mimeType,
    attachment.encryptedPath,
    attachment.sizeBytes,
    attachment.createdAt,
  );
}

// ── Read ──

export function getAttachmentById(
  db: Database.Database,
  id: string,
): AttachmentRow | undefined {
  const row = db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAttachmentRow(row) : undefined;
}

export function listAttachmentsForEntry(
  db: Database.Database,
  entryId: string,
): AttachmentRow[] {
  const rows = db
    .prepare("SELECT * FROM attachments WHERE entry_id = ? ORDER BY created_at")
    .all(entryId) as Record<string, unknown>[];
  return rows.map(rowToAttachmentRow);
}

// ── Delete ──

export function deleteAttachment(
  db: Database.Database,
  id: string,
): boolean {
  const result = db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
  return result.changes > 0;
}
