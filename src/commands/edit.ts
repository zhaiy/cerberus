import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CerberusError, ErrorCode } from "../core/errors.js";
import { isVaultInitialized } from "../core/paths.js";
import { withVaultWriteLock } from "../core/vault-lock.js";
import type { AppContext } from "../core/types.js";
import { updateEntryRecord, getEntryById } from "../storage/entries.js";
import { openDatabase } from "../storage/db.js";
import { overwriteEntryContent, readEntryContent } from "../services/vault-service.js";
import { requireSession } from "./unlock.js";

function runEditor(filePath: string): Promise<void> {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const argv = parseEditorCommand(editor);
  const [cmd, ...editorArgs] = argv;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...editorArgs, filePath], {
      stdio: "inherit",
      shell: false,
    });
    child.on("error", () => {
      reject(
        new CerberusError(
          "Could not launch editor. Set $EDITOR or $VISUAL.",
          ErrorCode.UNKNOWN,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new CerberusError(
          "Editor exited with non-zero status. Entry was not changed.",
          ErrorCode.UNKNOWN,
        ),
      );
    });
  });
}

function parseEditorCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped || quote) {
    throw new CerberusError(
      "Could not parse $EDITOR or $VISUAL.",
      ErrorCode.INVALID_ARGS,
    );
  }

  if (current.length > 0) {
    args.push(current);
  }

  if (args.length === 0) {
    throw new CerberusError(
      "Could not launch editor. Set $EDITOR or $VISUAL.",
      ErrorCode.UNKNOWN,
    );
  }

  return args;
}

export async function runEditCommand(
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

  const entryId = args[0];
  if (!entryId) {
    throw new CerberusError(
      "Usage: cerberus edit <entry-id>",
      ErrorCode.INVALID_ARGS,
    );
  }

  const identityPlain = await requireSession(paths);

  const db = openDatabase(paths);
  let entry;
  try {
    entry = getEntryById(db, entryId);
  } finally {
    db.close();
  }
  if (!entry) {
    identityPlain.fill(0);
    throw new CerberusError("Entry not found.", ErrorCode.VAULT_NOT_FOUND);
  }

  try {
    const originalContent = await readEntryContent(paths, identityPlain, entry.contentPath);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-edit-"));
    const tmpPath = path.join(tmpDir, `${entry.id}.txt`);
    await fs.writeFile(tmpPath, originalContent, { mode: 0o600 });
    try {
      await runEditor(tmpPath);
      const editedContent = await fs.readFile(tmpPath, "utf8");

      if (editedContent === originalContent) {
        console.log("No changes detected.");
        return;
      }
      if (!editedContent.trim()) {
        throw new CerberusError(
          "Edited content cannot be empty.",
          ErrorCode.INVALID_ARGS,
        );
      }

      await withVaultWriteLock(paths, async () => {
        await overwriteEntryContent(paths, identityPlain, entry.contentPath, editedContent);

        const dbForUpdate = openDatabase(paths);
        try {
          updateEntryRecord(dbForUpdate, entry.id, {
            updatedAt: new Date().toISOString(),
          });
        } finally {
          dbForUpdate.close();
        }
      });

      console.log(`Entry updated: ${entry.id}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  } finally {
    identityPlain.fill(0);
  }
}
