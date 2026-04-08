import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

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
    return lines.map((line) => JSON.parse(line));
  } catch {
    // Log file doesn't exist or is unreadable
    return [];
  }
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
