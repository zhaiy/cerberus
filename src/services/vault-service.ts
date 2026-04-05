import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDefaultConfig, saveConfig } from "../core/config.js";
import { ensureAppDirectories } from "../core/paths.js";
import type { AppPaths, EntryCategory } from "../core/types.js";
import { withVaultWriteLock } from "../core/vault-lock.js";
import { decryptBuffer, encryptBuffer, extractPublicKey } from "../crypto/age.js";
import { generateIdentity, wrapIdentityWithPassword } from "../crypto/identity.js";
import { openDatabase, runMigrations } from "../storage/db.js";
import { createEntryRecord, getEntryById } from "../storage/entries.js";
import { attachTagsToEntry, ensureTag } from "../storage/tags.js";
import { createAttachmentRecord, getAttachmentById } from "../storage/attachments.js";
import { CerberusError, ErrorCode } from "../core/errors.js";

export interface InitializeVaultOptions {
  masterPassword: string;
}

/**
 * Create directories, protected age identity, SQLite schema, and config.
 * Caller must ensure the vault is not already fully initialized.
 */
export async function initializeVault(
  paths: AppPaths,
  options: InitializeVaultOptions,
): Promise<void> {
  const { masterPassword } = options;

  await withVaultWriteLock(paths, async () => {
    await ensureAppDirectories(paths);

    let identityPlain: Buffer | undefined;
    try {
      identityPlain = await generateIdentity();
      await wrapIdentityWithPassword(
        identityPlain,
        masterPassword,
        paths.wrappedIdentityPath,
      );
    } finally {
      if (identityPlain) {
        identityPlain.fill(0);
      }
    }

    const db = openDatabase(paths);
    try {
      runMigrations(db);
    } finally {
      db.close();
    }

    const config = createDefaultConfig();
    await saveConfig(paths, config);
  });
}

// ── Entry operations ──

export interface CreateEntryOptions {
  title: string;
  category: EntryCategory;
  content: string;
  tags: string[];
  /** When set (e.g. import), used for metadata timestamps; otherwise `now` is used */
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Encrypt content, write it to disk, insert metadata into SQLite, attach tags.
 * Caller must already hold the vault write lock.
 * Returns the generated entry ID.
 */
export async function createEntryWithLockHeld(
  paths: AppPaths,
  identityPlain: Buffer,
  options: CreateEntryOptions,
): Promise<string> {
  const recipient = extractPublicKey(identityPlain);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const createdAt = options.createdAt ?? now;
  const updatedAt = options.updatedAt ?? now;
  const fileName = `${id}.age`;

  const ciphertext = await encryptBuffer(
    Buffer.from(options.content, "utf8"),
    recipient,
  );

  const contentFullPath = path.join(paths.entriesDir, fileName);
  await fs.mkdir(paths.entriesDir, { recursive: true });
  await fs.writeFile(contentFullPath, ciphertext, { mode: 0o600 });

  const db = openDatabase(paths);
  try {
    runMigrations(db);
    createEntryRecord(db, {
      id,
      title: options.title,
      category: options.category,
      contentPath: fileName,
      createdAt,
      updatedAt,
    });

    if (options.tags.length > 0) {
      const tagIds: number[] = [];
      for (const tagName of options.tags) {
        const trimmed = tagName.trim();
        if (trimmed.length === 0) continue;
        const tag = ensureTag(db, trimmed);
        tagIds.push(tag.id);
      }
      if (tagIds.length > 0) {
        attachTagsToEntry(db, id, tagIds);
      }
    }
  } finally {
    db.close();
  }

  return id;
}

/**
 * Encrypt content, write it to disk, insert metadata into SQLite, attach tags.
 * Returns the generated entry ID.
 */
export async function createEntry(
  paths: AppPaths,
  identityPlain: Buffer,
  options: CreateEntryOptions,
): Promise<string> {
  return withVaultWriteLock(paths, () =>
    createEntryWithLockHeld(paths, identityPlain, options),
  );
}

/**
 * Decrypt an entry's content file. Writes identity to a temp file (required
 * by age CLI), decrypts via stdin/stdout pipes, then wipes the temp file.
 */
export async function readEntryContent(
  paths: AppPaths,
  identityPlain: Buffer,
  contentFileName: string,
): Promise<string> {
  const encryptedPath = path.join(paths.entriesDir, contentFileName);
  const ciphertext = await fs.readFile(encryptedPath);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-decrypt-"));
  const identityPath = path.join(tmpDir, "identity");
  try {
    await fs.writeFile(identityPath, identityPlain, { mode: 0o600 });
    const plaintext = await decryptBuffer(ciphertext, identityPath);
    return plaintext.toString("utf8");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Re-encrypt updated content and atomically replace the original ciphertext file.
 * Writes to a temp file in the same directory first to avoid partial corruption.
 */
export async function overwriteEntryContent(
  paths: AppPaths,
  identityPlain: Buffer,
  contentFileName: string,
  content: string,
): Promise<void> {
  const recipient = extractPublicKey(identityPlain);
  const ciphertext = await encryptBuffer(Buffer.from(content, "utf8"), recipient);

  const finalPath = path.join(paths.entriesDir, contentFileName);
  const tempPath = path.join(
    paths.entriesDir,
    `${contentFileName}.tmp.${crypto.randomUUID()}`,
  );

  try {
    await fs.writeFile(tempPath, ciphertext, { mode: 0o600, flag: "wx" });
    await fs.rename(tempPath, finalPath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

// ── Attachment operations ──

export interface AddAttachmentOptions {
  entryId: string;
  filePath: string;
}

/**
 * Encrypt a file as an attachment bound to an entry.
 * Returns the generated attachment ID.
 */
export async function addAttachment(
  paths: AppPaths,
  identityPlain: Buffer,
  options: AddAttachmentOptions,
): Promise<string> {
  return withVaultWriteLock(paths, async () => {
    const db = openDatabase(paths);
    try {
      runMigrations(db);
      const entry = getEntryById(db, options.entryId);
      if (!entry) {
        throw new CerberusError("Entry not found.", ErrorCode.VAULT_NOT_FOUND);
      }
    } finally {
      db.close();
    }

    const plainData = await fs.readFile(options.filePath);
    const recipient = extractPublicKey(identityPlain);
    const ciphertext = await encryptBuffer(plainData, recipient);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const encryptedFileName = `${id}.age`;
    const encryptedFullPath = path.join(paths.attachmentsDir, encryptedFileName);

    await fs.mkdir(paths.attachmentsDir, { recursive: true });
    await fs.writeFile(encryptedFullPath, ciphertext, { mode: 0o600 });

    const originalName = path.basename(options.filePath);

    const db2 = openDatabase(paths);
    try {
      runMigrations(db2);
      createAttachmentRecord(db2, {
        id,
        entryId: options.entryId,
        originalName,
        mimeType: null,
        encryptedPath: encryptedFileName,
        sizeBytes: plainData.length,
        createdAt: now,
      });
    } finally {
      db2.close();
    }

    return id;
  });
}

/**
 * Decrypt an attachment and write the plaintext to the specified target path.
 * The target path must be provided explicitly — no temp directory is used.
 */
export async function exportAttachment(
  paths: AppPaths,
  identityPlain: Buffer,
  attachmentId: string,
  targetPath: string,
): Promise<string> {
  const db = openDatabase(paths);
  let attachment;
  try {
    attachment = getAttachmentById(db, attachmentId);
  } finally {
    db.close();
  }

  if (!attachment) {
    throw new CerberusError("Attachment not found.", ErrorCode.VAULT_NOT_FOUND);
  }

  const encryptedFullPath = path.join(paths.attachmentsDir, attachment.encryptedPath);
  const ciphertext = await fs.readFile(encryptedFullPath);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-export-"));
  const identityPath = path.join(tmpDir, "identity");
  try {
    await fs.writeFile(identityPath, identityPlain, { mode: 0o600 });
    const plaintext = await decryptBuffer(ciphertext, identityPath);
    await fs.writeFile(targetPath, plaintext, { mode: 0o600 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  return targetPath;
}
