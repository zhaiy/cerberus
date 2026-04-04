import fs from "node:fs/promises";
import path from "node:path";

import { CerberusError, ErrorCode } from "../core/errors.js";
import { isVaultInitialized } from "../core/paths.js";
import { addAttachment, exportAttachment } from "../services/vault-service.js";
import { openDatabase } from "../storage/db.js";
import { listAttachmentsForEntry } from "../storage/attachments.js";
import { requireSession } from "./unlock.js";
import type { AppContext } from "../core/types.js";

function parseAttachArgs(
  args: string[],
): { subcommand: string; positional: string[] } {
  const subcommand = args[0];
  const positional = args.slice(1).filter((a) => !a.startsWith("-"));
  return { subcommand, positional };
}

async function runAdd(
  context: AppContext,
  entryId: string,
  filePath: string,
): Promise<void> {
  const { paths } = context;

  const resolved = path.resolve(filePath);
  try {
    await fs.access(resolved);
  } catch {
    throw new CerberusError(
      `File not found: ${filePath}`,
      ErrorCode.INVALID_ARGS,
    );
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new CerberusError(
      "Not a regular file.",
      ErrorCode.INVALID_ARGS,
    );
  }

  const identityPlain = await requireSession(paths);
  try {
    const id = await addAttachment(paths, identityPlain, {
      entryId,
      filePath: resolved,
    });
    console.log(`Attachment added: ${id}`);
  } finally {
    identityPlain.fill(0);
  }
}

async function runList(
  context: AppContext,
  entryId: string,
): Promise<void> {
  const { paths } = context;

  const db = openDatabase(paths);
  try {
    const attachments = listAttachmentsForEntry(db, entryId);
    if (attachments.length === 0) {
      console.log("No attachments found for this entry.");
      return;
    }

    for (const att of attachments) {
      const shortId = att.id.slice(0, 8);
      const size = formatBytes(att.sizeBytes);
      const created = att.createdAt.slice(0, 16);
      console.log(
        `${shortId}  ${att.originalName.padEnd(24)} ${size.padStart(8)}  ${created}`,
      );
    }
  } finally {
    db.close();
  }
}

async function runExport(
  context: AppContext,
  attachmentId: string,
  targetPath: string,
): Promise<void> {
  const { paths } = context;

  const resolved = path.resolve(targetPath);
  const parentDir = path.dirname(resolved);
  try {
    await fs.access(parentDir);
  } catch {
    throw new CerberusError(
      `Target directory does not exist: ${parentDir}`,
      ErrorCode.INVALID_ARGS,
    );
  }

  const identityPlain = await requireSession(paths);
  try {
    await exportAttachment(paths, identityPlain, attachmentId, resolved);
    console.log(`Exported to: ${resolved}`);
  } finally {
    identityPlain.fill(0);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function runAttachCommand(
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

  const { subcommand, positional } = parseAttachArgs(args);

  switch (subcommand) {
    case "add": {
      const [entryId, filePath] = positional;
      if (!entryId || !filePath) {
        throw new CerberusError(
          "Usage: cerberus attach add <entry-id> <file-path>",
          ErrorCode.INVALID_ARGS,
        );
      }
      await runAdd(context, entryId, filePath);
      break;
    }
    case "list": {
      const [entryId] = positional;
      if (!entryId) {
        throw new CerberusError(
          "Usage: cerberus attach list <entry-id>",
          ErrorCode.INVALID_ARGS,
        );
      }
      await runList(context, entryId);
      break;
    }
    case "export": {
      const [attachmentId, targetPath] = positional;
      if (!attachmentId || !targetPath) {
        throw new CerberusError(
          "Usage: cerberus attach export <attachment-id> <target-path>",
          ErrorCode.INVALID_ARGS,
        );
      }
      await runExport(context, attachmentId, targetPath);
      break;
    }
    default:
      throw new CerberusError(
        "Usage: cerberus attach <add|list|export> ...",
        ErrorCode.INVALID_ARGS,
      );
  }
}
