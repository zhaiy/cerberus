import Database from "better-sqlite3";

import { CerberusError, ErrorCode } from "../core/errors.js";
import type { AppPaths } from "../core/types.js";

const SCHEMA_VERSION = 1;

export function openDatabase(appPaths: AppPaths): Database.Database {
  let db: Database.Database;
  try {
    db = new Database(appPaths.dbPath);
  } catch {
    throw new CerberusError(
      "Could not open the local database.",
      ErrorCode.UNKNOWN,
    );
  }
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  return db;
}

export function openExistingDatabaseReadonly(
  appPaths: AppPaths,
): Database.Database {
  let db: Database.Database;
  try {
    db = new Database(appPaths.dbPath, {
      readonly: true,
      fileMustExist: true,
    });
  } catch {
    throw new CerberusError(
      "Could not open the local database.",
      ErrorCode.UNKNOWN,
    );
  }
  db.pragma("foreign_keys = ON");
  return db;
}

export function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current === SCHEMA_VERSION) {
    return;
  }
  if (current > SCHEMA_VERSION) {
    throw new CerberusError(
      "Database version is newer than this tool supports.",
      ErrorCode.CONFIG_ERROR,
    );
  }

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        content_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (entry_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY NOT NULL,
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        mime_type TEXT,
        encrypted_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
  db.pragma("wal_checkpoint(TRUNCATE)");
}
