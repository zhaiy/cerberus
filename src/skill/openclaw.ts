import { resolveAppPaths } from "../core/paths.js";
import { isVaultInitialized } from "../core/paths.js";
import type { AppPaths, EntryCategory, EntryRow } from "../core/types.js";
import { withVaultWriteLock } from "../core/vault-lock.js";
import { openDatabase } from "../storage/db.js";
import {
  getEntryById,
  listEntryRecords,
  searchEntries,
  searchEntriesByTag,
  searchEntriesByTitle,
  softDeleteEntry,
  updateEntryRecord,
} from "../storage/entries.js";
import { getTagsForEntry } from "../storage/tags.js";
import {
  createEntry,
  readEntryContent,
  overwriteEntryContent,
  addAttachment,
  exportAttachment,
} from "../services/vault-service.js";
import { listAttachmentsForEntry } from "../storage/attachments.js";
import { requireSession } from "../commands/unlock.js";

// ── Request / Response types ──

export interface SkillRequest {
  intent: string;
  payload: Record<string, string>;
  vaultPath?: string;
  homePath?: string;
}

export interface SkillResponse {
  ok: boolean;
  message: string;
  data?: unknown;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeSkillErrorMessage(
  message: string,
  paths: AppPaths,
  request: SkillRequest,
): string {
  let sanitized = message;
  const explicitPaths = [
    request.vaultPath,
    request.homePath,
    paths.appDir,
    paths.vaultDir,
    paths.entriesDir,
    paths.attachmentsDir,
    paths.keysDir,
    paths.sessionsDir,
    ...Object.values(request.payload),
  ]
    .filter((value): value is string => typeof value === "string" && value.startsWith("/"))
    .sort((a, b) => b.length - a.length);

  for (const candidate of explicitPaths) {
    sanitized = sanitized.replace(
      new RegExp(escapeRegExp(candidate), "g"),
      "[path]",
    );
  }

  // Fall back to redacting any remaining absolute filesystem paths.
  return sanitized.replace(/(?<=^|[\s("'`])\/[^\s"'`)]+/g, "[path]");
}

// ── Intent handlers ──

async function handleNew(
  paths: AppPaths,
  payload: Record<string, string>,
): Promise<SkillResponse> {
  const title = payload.title;
  const category = (payload.category ?? "note") as EntryCategory;
  const content = payload.content;
  const tags = payload.tags
    ? payload.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  if (!title || !content) {
    return { ok: false, message: "Missing required fields: title and content." };
  }

  const VALID_CATEGORIES: EntryCategory[] = [
    "diary", "note", "last_words", "collection", "secret",
  ];
  if (!VALID_CATEGORIES.includes(category)) {
    return {
      ok: false,
      message: `Invalid category '${category}'. Valid: ${VALID_CATEGORIES.join(", ")}`,
    };
  }

  const identityPlain = await requireSession(paths);
  try {
    const id = await createEntry(paths, identityPlain, {
      title, category, content, tags,
    });
    return { ok: true, message: `Entry created.`, data: { id, title, category } };
  } finally {
    identityPlain.fill(0);
  }
}

async function handleList(
  paths: AppPaths,
  payload: Record<string, string>,
): Promise<SkillResponse> {
  const category = (payload.category ?? undefined) as EntryCategory | undefined;

  const db = openDatabase(paths);
  let entries: EntryRow[];
  try {
    entries = listEntryRecords(db, { category });
  } finally {
    db.close();
  }

  if (entries.length === 0) {
    return { ok: true, message: "No entries found." };
  }

  const items = entries.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    updatedAt: e.updatedAt,
  }));

  return {
    ok: true,
    message: `Found ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`,
    data: items,
  };
}

async function handleShow(
  paths: AppPaths,
  payload: Record<string, string>,
): Promise<SkillResponse> {
  const entryId = payload.id;
  if (!entryId) {
    return { ok: false, message: "Missing required field: id." };
  }

  const db = openDatabase(paths);
  let entry: EntryRow | undefined;
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
    return { ok: false, message: "Entry not found." };
  }

  const identityPlain = await requireSession(paths);
  let content: string;
  try {
    content = await readEntryContent(paths, identityPlain, entry.contentPath);
  } finally {
    identityPlain.fill(0);
  }

  return {
    ok: true,
    message: "Entry retrieved.",
    data: {
      id: entry.id,
      title: entry.title,
      category: entry.category,
      tags: tags.map((t) => t.name),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      content,
    },
  };
}

async function handleSearch(
  paths: AppPaths,
  payload: Record<string, string>,
): Promise<SkillResponse> {
  const query = payload.query ?? payload.title ?? payload.tag;
  if (!query) {
    return { ok: false, message: "Missing required field: query (or title / tag)." };
  }

  const db = openDatabase(paths);
  let entries: EntryRow[];
  try {
    if (payload.title) {
      entries = searchEntriesByTitle(db, payload.title);
    } else if (payload.tag) {
      entries = searchEntriesByTag(db, payload.tag);
    } else {
      entries = searchEntries(db, query);
    }
  } finally {
    db.close();
  }

  if (entries.length === 0) {
    return { ok: true, message: `No results for '${query}'.` };
  }

  const items = entries.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    updatedAt: e.updatedAt,
  }));

  return {
    ok: true,
    message: `Found ${entries.length} result${entries.length === 1 ? "" : "s"} for '${query}'.`,
    data: items,
  };
}

// ── Delete ──

async function handleDelete(
  paths: AppPaths,
  payload: Record<string, string>,
): Promise<SkillResponse> {
  const entryId = payload.id;
  if (!entryId) {
    return { ok: false, message: "Missing required field: id." };
  }

  const db = openDatabase(paths);
  let entry;
  try {
    entry = getEntryById(db, entryId);
  } finally {
    db.close();
  }
  if (!entry) {
    return { ok: false, message: "Entry not found." };
  }

  await withVaultWriteLock(paths, async () => {
    const dbForDelete = openDatabase(paths);
    try {
      const ok = softDeleteEntry(dbForDelete, entry.id, new Date().toISOString());
      if (!ok) {
        throw new Error("Entry not found.");
      }
    } finally {
      dbForDelete.close();
    }
  });

  return { ok: true, message: "Entry deleted." };
}

// ── Edit ──

async function handleEdit(
  paths: AppPaths,
  payload: Record<string, string>,
): Promise<SkillResponse> {
  const entryId = payload.id;
  const newContent = payload.content;
  const newTitle = payload.title;

  if (!entryId) {
    return { ok: false, message: "Missing required field: id." };
  }
  if (!newContent && !newTitle) {
    return { ok: false, message: "Nothing to update. Provide content and/or title." };
  }

  const db = openDatabase(paths);
  let entry;
  try {
    entry = getEntryById(db, entryId);
  } finally {
    db.close();
  }

  if (!entry) {
    return { ok: false, message: "Entry not found." };
  }

  const identityPlain = await requireSession(paths);
  try {
    await withVaultWriteLock(paths, async () => {
      if (newContent !== undefined) {
        if (!newContent.trim()) {
          throw new Error("Content cannot be empty.");
        }
        await overwriteEntryContent(paths, identityPlain, entry.contentPath, newContent);
      }

      if (newTitle !== undefined || newContent !== undefined) {
        const db2 = openDatabase(paths);
        try {
          updateEntryRecord(db2, entry.id, {
            ...(newTitle ? { title: newTitle } : {}),
            updatedAt: new Date().toISOString(),
          });
        } finally {
          db2.close();
        }
      }
    });
  } finally {
    identityPlain.fill(0);
  }

  return { ok: true, message: "Entry updated.", data: { id: entry.id } };
}

// ── Attach: add ──

async function handleAttachAdd(
  paths: AppPaths,
  payload: Record<string, string>,
): Promise<SkillResponse> {
  const entryId = payload.entryId ?? payload.entry_id ?? payload.id;
  const filePath = payload.filePath ?? payload.file_path ?? payload.path;

  if (!entryId || !filePath) {
    return { ok: false, message: "Missing required fields: entryId and filePath." };
  }

  const identityPlain = await requireSession(paths);
  try {
    const id = await addAttachment(paths, identityPlain, { entryId, filePath });
    return { ok: true, message: "Attachment added.", data: { id, entryId } };
  } finally {
    identityPlain.fill(0);
  }
}

// ── Attach: list ──

async function handleAttachList(
  paths: AppPaths,
  payload: Record<string, string>,
): Promise<SkillResponse> {
  const entryId = payload.entryId ?? payload.entry_id ?? payload.id;
  if (!entryId) {
    return { ok: false, message: "Missing required field: entryId." };
  }

  const db = openDatabase(paths);
  try {
    const attachments = listAttachmentsForEntry(db, entryId);
    if (attachments.length === 0) {
      return { ok: true, message: "No attachments found." };
    }

    const items = attachments.map((a) => ({
      id: a.id,
      originalName: a.originalName,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt,
    }));

    return {
      ok: true,
      message: `Found ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}.`,
      data: items,
    };
  } finally {
    db.close();
  }
}

// ── Attach: export ──

async function handleAttachExport(
  paths: AppPaths,
  payload: Record<string, string>,
): Promise<SkillResponse> {
  const attachmentId = payload.attachmentId ?? payload.attachment_id ?? payload.id;
  const targetPath = payload.targetPath ?? payload.target_path ?? payload.path;

  if (!attachmentId || !targetPath) {
    return { ok: false, message: "Missing required fields: attachmentId and targetPath." };
  }

  const identityPlain = await requireSession(paths);
  try {
    await exportAttachment(paths, identityPlain, attachmentId, targetPath);
    return { ok: true, message: "Attachment exported.", data: { attachmentId, targetPath } };
  } finally {
    identityPlain.fill(0);
  }
}

// ── Main dispatcher ──

const INTENT_MAP: Record<string, (paths: AppPaths, payload: Record<string, string>) => Promise<SkillResponse>> = {
  new: handleNew,
  create: handleNew,
  list: handleList,
  show: handleShow,
  get: handleShow,
  search: handleSearch,
  find: handleSearch,
  delete: handleDelete,
  remove: handleDelete,
  edit: handleEdit,
  update: handleEdit,
  attach_add: handleAttachAdd,
  attach_list: handleAttachList,
  attach_export: handleAttachExport,
};

export async function handleSkillRequest(request: SkillRequest): Promise<SkillResponse> {
  const paths = resolveAppPaths({
    appDir: request.vaultPath,
    homeDir: request.homePath,
  });

  if (!(await isVaultInitialized(paths))) {
    return { ok: false, message: "Vault is not initialized. Run `cerberus init` first." };
  }

  const handler = INTENT_MAP[request.intent.toLowerCase()];
  if (!handler) {
    const valid = Object.keys(INTENT_MAP).join(", ");
    return { ok: false, message: `Unknown intent '${request.intent}'. Supported: ${valid}` };
  }

  try {
    return await handler(paths, request.payload);
  } catch (err) {
    if (err instanceof Error) {
      return {
        ok: false,
        message: sanitizeSkillErrorMessage(err.message, paths, request),
      };
    }
    return { ok: false, message: "An unexpected error occurred." };
  }
}
