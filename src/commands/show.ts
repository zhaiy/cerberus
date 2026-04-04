import { CerberusError, ErrorCode } from "../core/errors.js";
import { isVaultInitialized } from "../core/paths.js";
import { openDatabase } from "../storage/db.js";
import { getEntryById } from "../storage/entries.js";
import { getTagsForEntry } from "../storage/tags.js";
import { requireSession } from "./unlock.js";
import { readEntryContent } from "../services/vault-service.js";
import type { AppContext } from "../core/types.js";

interface ShowArgs {
  entryId?: string;
  json: boolean;
}

function parseShowArgs(args: string[]): ShowArgs {
  const result: ShowArgs = { json: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") {
      result.json = true;
    } else if (!result.entryId && !args[i].startsWith("-")) {
      result.entryId = args[i];
    }
  }
  return result;
}

export async function runShowCommand(
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

  const { entryId, json } = parseShowArgs(args);
  if (!entryId) {
    throw new CerberusError(
      "Usage: cerberus show <entry-id>",
      ErrorCode.INVALID_ARGS,
    );
  }

  const identityPlain = await requireSession(paths);

  const db = openDatabase(paths);
  let entry;
  let tags: { name: string }[] = [];
  try {
    entry = getEntryById(db, entryId);
    if (entry) {
      tags = getTagsForEntry(db, entry.id);
    }
  } finally {
    db.close();
  }

  if (!entry) {
    throw new CerberusError("Entry not found.", ErrorCode.VAULT_NOT_FOUND);
  }

  let content: string;
  try {
    content = await readEntryContent(paths, identityPlain, entry.contentPath);
  } finally {
    identityPlain.fill(0);
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          id: entry.id,
          title: entry.title,
          category: entry.category,
          tags: tags.map((t) => t.name),
          content,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        },
        null,
        2,
      ),
    );
    return;
  }

  const tagStr = tags.length > 0 ? tags.map((t) => t.name).join(", ") : "-";
  console.log(`ID:       ${entry.id}`);
  console.log(`Title:    ${entry.title}`);
  console.log(`Category: ${entry.category}`);
  console.log(`Tags:     ${tagStr}`);
  console.log(`Created:  ${entry.createdAt}`);
  console.log(`Updated:  ${entry.updatedAt}`);
  console.log("---");
  console.log(content);
}
