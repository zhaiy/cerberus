import { CerberusError, ErrorCode } from "../core/errors.js";
import { promptLine } from "../core/prompt.js";
import { isVaultInitialized } from "../core/paths.js";
import { withVaultWriteLock } from "../core/vault-lock.js";
import type { AppContext } from "../core/types.js";
import { openDatabase } from "../storage/db.js";
import { getEntryById, softDeleteEntry } from "../storage/entries.js";
import { requireSession } from "./unlock.js";

function parseDeleteArgs(args: string[]): { entryId?: string; yes: boolean } {
  const yes = args.includes("--yes") || args.includes("-y");
  const entryId = args.find((arg) => !arg.startsWith("-"));
  return { entryId, yes };
}

export async function runDeleteCommand(
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

  const { entryId, yes } = parseDeleteArgs(args);
  if (!entryId) {
    throw new CerberusError(
      "Usage: cerberus delete <entry-id> [--yes]",
      ErrorCode.INVALID_ARGS,
    );
  }

  const identityPlain = await requireSession(paths);
  identityPlain.fill(0);

  const db = openDatabase(paths);
  let entry;
  try {
    entry = getEntryById(db, entryId);
  } finally {
    db.close();
  }
  if (!entry) {
    throw new CerberusError("Entry not found.", ErrorCode.VAULT_NOT_FOUND);
  }

  if (!yes) {
    if (!process.stdin.isTTY) {
      throw new CerberusError(
        "Refusing to delete without confirmation in non-interactive mode. Use --yes.",
        ErrorCode.INVALID_ARGS,
      );
    }
    const confirm = await promptLine(
      `Type 'yes' to delete entry ${entry.id} (${entry.title})`,
    );
    if (confirm !== "yes") {
      console.log("Delete cancelled.");
      return;
    }
  }

  await withVaultWriteLock(paths, async () => {
    const dbForDelete = openDatabase(paths);
    try {
      const ok = softDeleteEntry(dbForDelete, entry.id, new Date().toISOString());
      if (!ok) {
        throw new CerberusError("Entry not found.", ErrorCode.VAULT_NOT_FOUND);
      }
    } finally {
      dbForDelete.close();
    }
  });
  console.log(`Entry deleted: ${entry.id}`);
}
