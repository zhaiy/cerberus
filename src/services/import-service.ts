import fs from "node:fs/promises";
import path from "node:path";

import { CerberusError, ErrorCode } from "../core/errors.js";
import { withVaultWriteLock } from "../core/vault-lock.js";
import type { AppPaths, EntryCategory } from "../core/types.js";
import { createEntryWithLockHeld } from "./vault-service.js";

const VALID_CATEGORIES: EntryCategory[] = [
  "diary",
  "note",
  "last_words",
  "collection",
  "secret",
];

export type ImportFormat = "json" | "markdown";

export interface ImportOptions {
  format: ImportFormat;
  /** Absolute path to directory containing plaintext export (entries.json or *.md) */
  inputDir: string;
}

export interface ImportResult {
  success: number;
  skipped: number;
  conflict: number;
}

interface ParsedItem {
  title: string;
  category: EntryCategory;
  content: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  /** Original export id (JSON only), for duplicate detection */
  sourceId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExportedJsonEntry(
  raw: unknown,
  index: number,
): ParsedItem | null {
  if (!isRecord(raw)) {
    return null;
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const content = typeof raw.content === "string" ? raw.content : "";
  const category = raw.category;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (title.length === 0 || content.length === 0) {
    return null;
  }
  if (typeof category !== "string" || !VALID_CATEGORIES.includes(category as EntryCategory)) {
    return null;
  }
  let tags: string[] = [];
  if (Array.isArray(raw.tags)) {
    tags = raw.tags.filter((t): t is string => typeof t === "string");
  }
  let createdAt: string | undefined;
  let updatedAt: string | undefined;
  if (typeof raw.createdAt === "string") {
    createdAt = raw.createdAt;
  }
  if (typeof raw.updatedAt === "string") {
    updatedAt = raw.updatedAt;
  }
  return {
    title,
    category: category as EntryCategory,
    content,
    tags,
    createdAt,
    updatedAt,
    sourceId: id.length > 0 ? id : `row-${index}`,
  };
}

async function collectJsonItems(inputDir: string): Promise<{
  items: ParsedItem[];
  stats: ImportResult;
}> {
  const filePath = path.join(inputDir, "entries.json");
  let rawText: string;
  try {
    rawText = await fs.readFile(filePath, "utf8");
  } catch {
    throw new CerberusError(
      `Cannot read ${path.join(inputDir, "entries.json")}`,
      ErrorCode.INVALID_ARGS,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new CerberusError(
      "entries.json is not valid JSON",
      ErrorCode.INVALID_ARGS,
    );
  }
  if (!Array.isArray(data)) {
    throw new CerberusError(
      "entries.json must contain a JSON array",
      ErrorCode.INVALID_ARGS,
    );
  }

  const stats: ImportResult = { success: 0, skipped: 0, conflict: 0 };
  const items: ParsedItem[] = [];
  const seenSourceIds = new Set<string>();

  for (let i = 0; i < data.length; i++) {
    const parsed = parseExportedJsonEntry(data[i], i);
    if (!parsed) {
      stats.skipped += 1;
      continue;
    }
    const sid = parsed.sourceId ?? `row-${i}`;
    if (seenSourceIds.has(sid)) {
      stats.conflict += 1;
      continue;
    }
    seenSourceIds.add(sid);
    items.push(parsed);
  }

  return { items, stats };
}

/**
 * Parse Cerberus markdown export (see export-service entryToMarkdown).
 */
export function parseExportedMarkdownFile(
  text: string,
): ParsedItem | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length < 2) {
    return null;
  }
  const titleLine = lines[0].match(/^# (.+)$/);
  if (!titleLine) {
    return null;
  }
  const title = titleLine[1].trim();
  let i = 1;
  while (i < lines.length && lines[i].trim() === "") {
    i += 1;
  }
  const meta: Record<string, string> = {};
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^- \*\*([^*]+):\*\* (.+)$/);
    if (!m) {
      break;
    }
    meta[m[1].trim().toLowerCase()] = m[2].trim();
    i += 1;
  }
  while (i < lines.length && lines[i].trim() === "") {
    i += 1;
  }
  const content = lines.slice(i).join("\n");
  if (title.length === 0 || content.length === 0) {
    return null;
  }
  const catRaw = meta.category ?? "note";
  if (!VALID_CATEGORIES.includes(catRaw as EntryCategory)) {
    return null;
  }
  const tagsStr = meta.tags ?? "";
  const tags =
    tagsStr === "-"
      ? []
      : tagsStr.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  let createdAt: string | undefined;
  let updatedAt: string | undefined;
  if (meta.created) {
    createdAt = meta.created;
  }
  if (meta.updated) {
    updatedAt = meta.updated;
  }
  return {
    title,
    category: catRaw as EntryCategory,
    content,
    tags,
    createdAt,
    updatedAt,
  };
}

async function collectMarkdownItems(inputDir: string): Promise<{
  items: ParsedItem[];
  stats: ImportResult;
}> {
  let names: string[];
  try {
    names = await fs.readdir(inputDir);
  } catch {
    throw new CerberusError(
      `Cannot read import directory: ${inputDir}`,
      ErrorCode.INVALID_ARGS,
    );
  }
  const mdFiles = names
    .filter((n) => n.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  const stats: ImportResult = { success: 0, skipped: 0, conflict: 0 };
  const items: ParsedItem[] = [];

  for (const name of mdFiles) {
    const filePath = path.join(inputDir, name);
    const st = await fs.stat(filePath);
    if (!st.isFile()) {
      stats.skipped += 1;
      continue;
    }
    const text = await fs.readFile(filePath, "utf8");
    const parsed = parseExportedMarkdownFile(text);
    if (!parsed) {
      stats.skipped += 1;
      continue;
    }
    items.push(parsed);
  }

  return { items, stats };
}

async function assertImportDir(dir: string): Promise<void> {
  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) {
      throw new CerberusError(
        `Import path is not a directory: ${dir}`,
        ErrorCode.INVALID_ARGS,
      );
    }
  } catch (e) {
    if (e instanceof CerberusError) {
      throw e;
    }
    throw new CerberusError(
      `Import directory not found: ${dir}`,
      ErrorCode.INVALID_ARGS,
    );
  }
}

/**
 * Import plaintext entries from a directory. Acquires one vault write lock for all inserts.
 */
export async function importPlaintextEntries(
  appPaths: AppPaths,
  identityPlain: Buffer,
  options: ImportOptions,
): Promise<ImportResult> {
  const inputDir = path.resolve(options.inputDir);
  await assertImportDir(inputDir);

  let items: ParsedItem[];
  let parseStats: ImportResult;

  if (options.format === "json") {
    const r = await collectJsonItems(inputDir);
    items = r.items;
    parseStats = r.stats;
  } else {
    const r = await collectMarkdownItems(inputDir);
    items = r.items;
    parseStats = r.stats;
  }

  if (items.length === 0) {
    return {
      success: parseStats.success,
      skipped: parseStats.skipped,
      conflict: parseStats.conflict,
    };
  }

  let success = parseStats.success;

  await withVaultWriteLock(appPaths, async () => {
    for (const item of items) {
      await createEntryWithLockHeld(appPaths, identityPlain, {
        title: item.title,
        category: item.category,
        content: item.content,
        tags: item.tags,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
      success += 1;
    }
  });

  return {
    success,
    skipped: parseStats.skipped,
    conflict: parseStats.conflict,
  };
}
