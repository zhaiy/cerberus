import { CerberusError, ErrorCode } from "../core/errors.js";
import { isVaultInitialized } from "../core/paths.js";
import { openDatabase } from "../storage/db.js";
import { listEntryRecords } from "../storage/entries.js";
import { getTagsForEntry } from "../storage/tags.js";
import type { AppContext, EntryCategory, EntryRow } from "../core/types.js";

const VALID_CATEGORIES: EntryCategory[] = [
  "diary",
  "note",
  "last_words",
  "collection",
  "secret",
];

interface ListArgs {
  category?: EntryCategory;
  json: boolean;
}

function parseListArgs(args: string[]): ListArgs {
  const result: ListArgs = { json: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--category" && args[i + 1]) {
      const val = args[++i];
      if (!VALID_CATEGORIES.includes(val as EntryCategory)) {
        throw new CerberusError(
          `Invalid category. Valid: ${VALID_CATEGORIES.join(", ")}`,
          ErrorCode.INVALID_ARGS,
        );
      }
      result.category = val as EntryCategory;
    } else if (args[i] === "--json") {
      result.json = true;
    }
  }
  return result;
}

export interface EntryJsonOutput {
  id: string;
  title: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function entriesToJsonOutput(
  db: import("better-sqlite3").Database,
  entries: EntryRow[],
): EntryJsonOutput[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    category: entry.category,
    tags: getTagsForEntry(db, entry.id).map((t) => t.name),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
}

export async function runListCommand(
  context: AppContext,
  args: string[],
): Promise<void> {
  const { paths } = context;

  if (!(await isVaultInitialized(paths))) {
    throw new CerberusError(
      "Vault is not initialized. Run `cerberus init` first.",
      ErrorCode.VAULT_NOT_FOUND,
    );
  }

  const { category, json } = parseListArgs(args);

  const db = openDatabase(paths);
  try {
    const entries = listEntryRecords(db, { category });

    if (entries.length === 0) {
      if (json) {
        console.log(JSON.stringify([]));
      } else {
        console.log("No entries found.");
      }
      return;
    }

    if (json) {
      console.log(JSON.stringify(entriesToJsonOutput(db, entries), null, 2));
      return;
    }

    for (const entry of entries) {
      const tags = getTagsForEntry(db, entry.id);
      const tagStr = tags.length > 0 ? tags.map((t) => t.name).join(", ") : "-";
      const shortId = entry.id.slice(0, 8);
      const updated = entry.updatedAt.slice(0, 16);
      console.log(
        `${shortId}  ${entry.category.padEnd(12)} ${updated}  ${entry.title}  [${tagStr}]`,
      );
    }
  } finally {
    db.close();
  }
}
