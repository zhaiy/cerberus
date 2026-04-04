import { CerberusError, ErrorCode } from "../core/errors.js";
import { isVaultInitialized } from "../core/paths.js";
import { openDatabase } from "../storage/db.js";
import {
  searchEntriesByTag,
  searchEntriesByTitle,
} from "../storage/entries.js";
import { getTagsForEntry } from "../storage/tags.js";
import { entriesToJsonOutput } from "./list.js";
import type { AppContext, EntryRow } from "../core/types.js";

interface SearchArgs {
  title?: string;
  tag?: string;
  json: boolean;
}

function parseSearchArgs(args: string[]): SearchArgs {
  const result: SearchArgs = { json: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--title" && args[i + 1]) {
      result.title = args[++i];
    } else if (args[i] === "--tag" && args[i + 1]) {
      result.tag = args[++i];
    } else if (args[i] === "--json") {
      result.json = true;
    }
  }
  return result;
}

function printEntries(db: import("better-sqlite3").Database, entries: EntryRow[]): void {
  if (entries.length === 0) {
    console.log("No matching entries found.");
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
}

export async function runSearchCommand(
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

  const { title, tag, json } = parseSearchArgs(args);

  if (!title && !tag) {
    throw new CerberusError(
      "Usage: cerberus search --title <query> | --tag <query>",
      ErrorCode.INVALID_ARGS,
    );
  }

  if (title && tag) {
    throw new CerberusError(
      "Choose either --title or --tag, not both.",
      ErrorCode.INVALID_ARGS,
    );
  }

  const db = openDatabase(paths);
  try {
    const entries = title
      ? searchEntriesByTitle(db, title)
      : searchEntriesByTag(db, tag!);

    if (json) {
      console.log(JSON.stringify(entriesToJsonOutput(db, entries), null, 2));
      return;
    }

    printEntries(db, entries);
  } finally {
    db.close();
  }
}
