import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../core/config.js";
import { CerberusError, ErrorCode } from "../core/errors.js";
import { appendOperationLog, createOperationLogEntry } from "../core/operation-log.js";
import { isVaultFullyInitialized } from "../core/paths.js";
import type { AppPaths } from "../core/types.js";
import { withVaultWriteLock } from "../core/vault-lock.js";
import { openDatabase } from "../storage/db.js";
import { openExistingDatabaseReadonly } from "../storage/db.js";

export type DoctorIssueKind =
  | "config_missing"
  | "config_invalid"
  | "database_missing"
  | "database_unreadable"
  | "database_schema_invalid"
  | "identity_missing"
  | "entry_missing_ciphertext"
  | "attachment_missing_ciphertext"
  | "orphan_entry_file"
  | "orphan_attachment_file";

export interface DoctorIssue {
  kind: DoctorIssueKind;
  detail: string;
  /** Relative path under vault root (posix-style) or absolute when appropriate */
  path?: string;
  /** Set when kind is entry_missing_ciphertext */
  entryId?: string;
  /** Set when kind is attachment_missing_ciphertext */
  attachmentId?: string;
}

export interface DoctorCheckResult {
  ok: boolean;
  issues: DoctorIssue[];
}

export interface DoctorJsonReport {
  ok: boolean;
  issues: Array<{
    kind: DoctorIssueKind;
    detail: string;
    path: string | null;
    entry_id: string | null;
    attachment_id: string | null;
  }>;
}

function toJsonReport(result: DoctorCheckResult): DoctorJsonReport {
  return {
    ok: result.ok,
    issues: result.issues
      .slice()
      .sort((a, b) => {
        const k = a.kind.localeCompare(b.kind);
        if (k !== 0) return k;
        return (a.path ?? "").localeCompare(b.path ?? "");
      })
      .map((i) => ({
        kind: i.kind,
        detail: i.detail,
        path: i.path ?? null,
        entry_id: i.entryId ?? null,
        attachment_id: i.attachmentId ?? null,
      })),
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listAgeFiles(dir: string): Promise<string[]> {
  let dirEntries: import("node:fs").Dirent[];
  try {
    dirEntries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return dirEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".age"))
    .map((entry) => entry.name);
}

function hasExpectedTables(db: ReturnType<typeof openExistingDatabaseReadonly>): boolean {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('entries', 'attachments', 'tags', 'entry_tags')",
    )
    .all() as { name: string }[];
  return rows.length === 4;
}

/**
 * Read-only consistency check: config, database, ciphertext files vs metadata.
 * Does not modify data.
 */
export async function runDoctorCheck(appPaths: AppPaths): Promise<DoctorCheckResult> {
  const issues: DoctorIssue[] = [];

  const configOk = await pathExists(appPaths.configPath);
  if (!configOk) {
    issues.push({
      kind: "config_missing",
      detail: "config.json is missing",
      path: "config.json",
    });
  } else {
    try {
      await loadConfig(appPaths);
    } catch (e) {
      const msg = e instanceof CerberusError ? e.message : "Invalid config";
      issues.push({
        kind: "config_invalid",
        detail: msg,
        path: "config.json",
      });
    }
  }

  const identityOk = await pathExists(appPaths.wrappedIdentityPath);
  if (!identityOk) {
    issues.push({
      kind: "identity_missing",
      detail: "Wrapped identity is missing",
      path: "keys/identity.age.enc",
    });
  }

  const dbOk = await pathExists(appPaths.dbPath);
  if (!dbOk) {
    issues.push({
      kind: "database_missing",
      detail: "db.sqlite is missing",
      path: "db.sqlite",
    });
  }

  let db: ReturnType<typeof openDatabase> | undefined;
  let schemaOk = false;
  if (dbOk) {
    try {
      db = openExistingDatabaseReadonly(appPaths);
      schemaOk = hasExpectedTables(db);
      if (!schemaOk) {
        issues.push({
          kind: "database_schema_invalid",
          detail: "db.sqlite is missing required Cerberus tables",
          path: "db.sqlite",
        });
      }
    } catch {
      issues.push({
        kind: "database_unreadable",
        detail: "Could not open db.sqlite in read-only mode",
        path: "db.sqlite",
      });
    }
  }

  if (db && schemaOk) {
    try {
      const entryRows = db
        .prepare(
          "SELECT id, content_path FROM entries",
        )
        .all() as { id: string; content_path: string }[];

      const referencedEntryFiles = new Set<string>();
      for (const row of entryRows) {
        referencedEntryFiles.add(row.content_path);
        const abs = path.join(appPaths.entriesDir, row.content_path);
        if (!(await pathExists(abs))) {
          issues.push({
            kind: "entry_missing_ciphertext",
            detail: `Entry ${row.id} references missing ciphertext`,
            path: path.posix.join("vault/entries", row.content_path),
            entryId: row.id,
          });
        }
      }

      const attRows = db
        .prepare("SELECT id, encrypted_path FROM attachments")
        .all() as { id: string; encrypted_path: string }[];

      const referencedAttFiles = new Set<string>();
      for (const row of attRows) {
        referencedAttFiles.add(row.encrypted_path);
        const abs = path.join(appPaths.attachmentsDir, row.encrypted_path);
        if (!(await pathExists(abs))) {
          issues.push({
            kind: "attachment_missing_ciphertext",
            detail: `Attachment ${row.id} references missing ciphertext`,
            path: path.posix.join("vault/attachments", row.encrypted_path),
            attachmentId: row.id,
          });
        }
      }

      const entryDiskNames = await listAgeFiles(appPaths.entriesDir);

      for (const name of entryDiskNames) {
        if (!referencedEntryFiles.has(name)) {
          issues.push({
            kind: "orphan_entry_file",
            detail: "Encrypted file is not referenced by any active entry",
            path: path.posix.join("vault/entries", name),
          });
        }
      }

      const attDiskNames = await listAgeFiles(appPaths.attachmentsDir);

      for (const name of attDiskNames) {
        if (!referencedAttFiles.has(name)) {
          issues.push({
            kind: "orphan_attachment_file",
            detail: "Encrypted file is not referenced by any attachment record",
            path: path.posix.join("vault/attachments", name),
          });
        }
      }
    } finally {
      db.close();
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function formatDoctorCheckJson(result: DoctorCheckResult): string {
  return `${JSON.stringify(toJsonReport(result), null, 2)}\n`;
}

// ── Cleanup (conservative) ──

export type CleanupActionKind =
  | "delete_orphan_entry_file"
  | "delete_orphan_attachment_file";

export interface CleanupPlanItem {
  action: CleanupActionKind;
  detail: string;
  /** Absolute path for file deletes; entry id for DB deletes */
  target: string;
}

export interface CleanupPlan {
  items: CleanupPlanItem[];
}

/**
 * Derive cleanup actions from a check result (only unambiguous orphans).
 */
export function planCleanupFromCheck(
  appPaths: AppPaths,
  check: DoctorCheckResult,
): CleanupPlan {
  const items: CleanupPlanItem[] = [];

  for (const issue of check.issues) {
    if (issue.kind === "orphan_entry_file" && issue.path) {
      const name = issue.path.replace(/^vault\/entries\//, "");
      if (
        name.length > 0 &&
        !name.includes("/") &&
        !name.includes("..") &&
        name.endsWith(".age")
      ) {
        items.push({
          action: "delete_orphan_entry_file",
          detail: issue.detail,
          target: path.join(appPaths.entriesDir, name),
        });
      }
    } else if (issue.kind === "orphan_attachment_file" && issue.path) {
      const name = issue.path.replace(/^vault\/attachments\//, "");
      if (
        name.length > 0 &&
        !name.includes("/") &&
        !name.includes("..") &&
        name.endsWith(".age")
      ) {
        items.push({
          action: "delete_orphan_attachment_file",
          detail: issue.detail,
          target: path.join(appPaths.attachmentsDir, name),
        });
      }
    }
  }

  items.sort((a, b) => {
    const byAction = a.action.localeCompare(b.action);
    if (byAction !== 0) return byAction;
    return a.target.localeCompare(b.target);
  });
  return { items };
}

/**
 * Apply cleanup plan: delete orphan files only.
 */
export async function applyCleanup(
  appPaths: AppPaths,
  plan: CleanupPlan,
): Promise<void> {
  await withVaultWriteLock(appPaths, async () => {
    for (const item of plan.items) {
      await fs.rm(item.target, { force: true });
    }
  });
}

export async function runDoctorCleanup(
  appPaths: AppPaths,
  options: { apply: boolean },
): Promise<{ plan: CleanupPlan; applied: boolean }> {
  const startTime = Date.now();
  try {
    const initialized = await isVaultFullyInitialized(appPaths);
    if (!initialized) {
      throw new CerberusError(
        "Vault is not fully initialized.",
        ErrorCode.VAULT_NOT_FOUND,
      );
    }

    const check = await runDoctorCheck(appPaths);
    const plan = planCleanupFromCheck(appPaths, check);

    if (options.apply && plan.items.length > 0) {
      await applyCleanup(appPaths, plan);
    }

    const result = {
      plan,
      applied: options.apply,
    };

    try {
      const mode = options.apply ? "apply" : "dry-run";
      await appendOperationLog(
        appPaths,
        createOperationLogEntry({
          command: "doctor",
          subcommand: "cleanup",
          result: "success",
          targetPath: appPaths.vaultDir,
          summary: `Cleanup ${mode}: ${plan.items.length} action(s) for ${appPaths.vaultDir}`,
          durationMs: Date.now() - startTime,
        }),
      );
    } catch {
      // Silent fail - logging is not critical
    }

    return result;
  } catch (e) {
    const error = e instanceof CerberusError ? e.message : String(e);
    try {
      await appendOperationLog(
        appPaths,
        createOperationLogEntry({
          command: "doctor",
          subcommand: "cleanup",
          result: "failed",
          targetPath: appPaths.vaultDir,
          summary: `Cleanup failed: ${error}`,
          error,
          durationMs: Date.now() - startTime,
        }),
      );
    } catch {
      // Silent fail - logging is not critical
    }
    throw e;
  }
}
