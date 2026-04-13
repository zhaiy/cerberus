import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { CerberusError, ErrorCode } from "./errors.js";
import { sanitizePaths } from "./json-envelope.js";
import type { AppPaths } from "./types.js";

/** Operation log entry stored in the log file */
export interface OperationLogEntry {
  /** Unique ID for the operation */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Command name (e.g., "backup", "import", "cleanup") */
  command: string;
  /** Subcommand (e.g., "create", "restore") */
  subcommand?: string;
  /** Operation result: success or failed */
  result: "success" | "failed";
  /** Target path (if applicable) */
  targetPath?: string;
  /** Human-readable summary (no sensitive data) */
  summary: string;
  /** Error message (only for failed operations) */
  error?: string;
  /** Operation duration in milliseconds */
  durationMs?: number;
}

const LOG_FILENAME = "operations.log";
const MAX_LOG_ENTRIES = 1000;
const MAX_LOG_SIZE_BYTES = 256 * 1024;

/** Get the path to the operation log file */
export function getOperationLogPath(paths: AppPaths): string {
  return path.join(paths.appDir, LOG_FILENAME);
}

/** Create a new operation log entry */
export function createOperationLogEntry(
  options: Omit<OperationLogEntry, "id" | "timestamp">,
): OperationLogEntry {
  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    ...options,
    summary: sanitizePaths(options.summary),
    error: options.error ? sanitizePaths(options.error) : undefined,
  };
}

/** Generate a unique ID for log entries */
function generateId(): string {
  return `op_${crypto.randomUUID()}`;
}

/** Append an entry to the operation log */
export async function appendOperationLog(
  paths: AppPaths,
  entry: OperationLogEntry,
): Promise<void> {
  const logPath = getOperationLogPath(paths);
  const line = JSON.stringify(entry) + "\n";
  try {
    await fs.mkdir(paths.appDir, { recursive: true });
    await fs.appendFile(logPath, line, "utf8");
    const stat = await fs.stat(logPath);
    if (stat.size > MAX_LOG_SIZE_BYTES) {
      await cleanupOperationLog(paths, MAX_LOG_ENTRIES);
    }
  } catch {
    // If writing to the log fails, silently fail - logging is not critical
  }
}

/** Read all operation log entries */
export async function readOperationLog(
  paths: AppPaths,
): Promise<OperationLogEntry[]> {
  const logPath = getOperationLogPath(paths);
  try {
    const content = await fs.readFile(logPath, "utf8");
    const lines = content.trim().split("\n").filter((line) => line.length > 0);
    const entries: OperationLogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
    return entries;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw new CerberusError(
      "Could not read operation log.",
      ErrorCode.IO_FAILED,
    );
  }
}

export function redactOperationLogEntry(
  entry: OperationLogEntry,
): Omit<OperationLogEntry, "targetPath"> {
  const { targetPath: _, ...safe } = entry;
  return {
    ...safe,
    summary: sanitizePaths(safe.summary),
    error: safe.error ? sanitizePaths(safe.error) : undefined,
  };
}

/** Clear old operation log entries (keep last N entries) */
export async function cleanupOperationLog(
  paths: AppPaths,
  keepCount: number = 1000,
): Promise<void> {
  const entries = await readOperationLog(paths);
  if (entries.length <= keepCount) {
    return;
  }

  const recent = entries.slice(-keepCount);
  const logPath = getOperationLogPath(paths);
  const content = recent.map((e) => JSON.stringify(e)).join("\n") + "\n";
  try {
    await fs.writeFile(logPath, content, "utf8");
  } catch {
    // Silent fail - logging is not critical
  }
}

/** Filter options for operation log queries */
export interface OperationFilterOptions {
  last?: number;
  command?: string;
  result?: "success" | "failed";
}

/** Filter operation log entries in memory */
export function filterOperationLog(
  entries: OperationLogEntry[],
  options: OperationFilterOptions,
): OperationLogEntry[] {
  let filtered = entries;

  if (options.command) {
    filtered = filtered.filter((e) => e.command === options.command);
  }

  if (options.result) {
    filtered = filtered.filter((e) => e.result === options.result);
  }

  // Apply last-N after filtering (most recent entries are at the end)
  if (options.last !== undefined && options.last > 0) {
    filtered = filtered.slice(-options.last);
  }

  return filtered;
}

/** Find a single operation log entry by ID */
export function findOperationById(
  entries: OperationLogEntry[],
  id: string,
): OperationLogEntry | undefined {
  return entries.find((e) => e.id === id);
}
