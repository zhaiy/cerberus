import type Database from "better-sqlite3";

import type { EntryRow } from "../core/types.js";
import { searchEntries } from "../storage/entries.js";

export { searchEntries as searchByTitleOrTag };

export function search(
  db: Database.Database,
  query: string,
): EntryRow[] {
  return searchEntries(db, query);
}
