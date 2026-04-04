import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { CerberusError, ErrorCode } from "../core/errors.js";
import type { AppPaths, EntryCategory, EntryRow } from "../core/types.js";
import { openDatabase } from "../storage/db.js";
import { listEntryRecords } from "../storage/entries.js";
import { getTagsForEntry } from "../storage/tags.js";
import { readEntryContent } from "../services/vault-service.js";

// ── Types ──

export type ExportFormat = "json" | "markdown";

export interface ExportOptions {
  /** Export all entries (no category filter) */
  all: boolean;
  /** Filter by category (mutually exclusive with all=false) */
  category?: EntryCategory;
  /** Output format */
  format: ExportFormat;
  /** Absolute path to the output directory */
  outputDir: string;
}

export interface ExportedEntry {
  id: string;
  title: string;
  category: string;
  tags: string[];
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ── Formatting ──

function entryToMarkdown(entry: ExportedEntry): string {
  const tagStr = entry.tags.length > 0 ? entry.tags.join(", ") : "-";
  return [
    `# ${entry.title}`,
    "",
    `- **ID:** ${entry.id}`,
    `- **Category:** ${entry.category}`,
    `- **Tags:** ${tagStr}`,
    `- **Created:** ${entry.createdAt}`,
    `- **Updated:** ${entry.updatedAt}`,
    "",
    entry.content,
  ].join("\n");
}

function safeFileName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// ── Public API ──

export async function exportEntries(
  appPaths: AppPaths,
  identityPlain: Buffer,
  options: ExportOptions,
): Promise<number> {
  const { format, outputDir } = options;

  // Fetch entries from DB
  const db = openDatabase(appPaths);
  let entries: EntryRow[];
  try {
    entries = listEntryRecords(db, {
      category: options.all ? undefined : options.category,
    });
  } finally {
    db.close();
  }

  if (entries.length === 0) {
    throw new CerberusError(
      "No entries to export.",
      ErrorCode.UNKNOWN,
    );
  }

  // Create output dir (must not exist)
  try {
    await fs.access(outputDir);
    throw new CerberusError(
      `Output directory already exists: ${outputDir}`,
      ErrorCode.INVALID_ARGS,
    );
  } catch (e) {
    if (e instanceof CerberusError) throw e;
  }
  await fs.mkdir(outputDir, { recursive: true });

  // Decrypt and collect
  const exported: ExportedEntry[] = [];
  try {
    for (const entry of entries) {
      const content = await readEntryContent(
        appPaths,
        identityPlain,
        entry.contentPath,
      );

      const db2 = openDatabase(appPaths);
      let tags: string[];
      try {
        tags = getTagsForEntry(db2, entry.id).map((t) => t.name);
      } finally {
        db2.close();
      }

      exported.push({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        tags,
        content,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
    }
  } finally {
    identityPlain.fill(0);
  }

  // Write output
  if (format === "json") {
    await writeJson(outputDir, exported);
  } else {
    await writeMarkdown(outputDir, exported);
  }

  return exported.length;
}

async function writeJson(
  outputDir: string,
  entries: ExportedEntry[],
): Promise<void> {
  const filePath = path.join(outputDir, "entries.json");
  const json = JSON.stringify(entries, null, 2) + "\n";
  await fs.writeFile(filePath, json, "utf8");
}

async function writeMarkdown(
  outputDir: string,
  entries: ExportedEntry[],
): Promise<void> {
  // Deduplicate filenames with a counter
  const usedNames = new Map<string, number>();

  for (const entry of entries) {
    const base = safeFileName(entry.title) || entry.id;
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);

    const fileName =
      count === 0 ? `${base}.md` : `${base}-${count}.md`;
    const filePath = path.join(outputDir, fileName);
    await fs.writeFile(filePath, entryToMarkdown(entry), "utf8");
  }
}
