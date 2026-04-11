import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runBackupCommand } from "../../src/commands/backup.js";
import { runDoctorCommand } from "../../src/commands/doctor.js";
import { runImportCommand } from "../../src/commands/import.js";
import { readOperationLog } from "../../src/core/operation-log.js";
import type { AppContext, AppPaths } from "../../src/core/types.js";
import { unwrapIdentityWithPassword } from "../../src/crypto/identity.js";
import { openSession } from "../../src/crypto/session.js";
import { createBackup } from "../../src/services/backup-service.js";
import { exportEntries } from "../../src/services/export-service.js";
import { createEntry, initializeVault } from "../../src/services/vault-service.js";

function tempPaths(root: string): AppPaths {
  return {
    homeDir: root,
    appDir: root,
    vaultDir: path.join(root, "vault"),
    entriesDir: path.join(root, "vault", "entries"),
    attachmentsDir: path.join(root, "vault", "attachments"),
    configPath: path.join(root, "config.json"),
    dbPath: path.join(root, "db.sqlite"),
    keysDir: path.join(root, "keys"),
    wrappedIdentityPath: path.join(root, "keys", "identity.age.enc"),
    sessionsDir: path.join(root, "sessions"),
  };
}

function context(paths: AppPaths): AppContext {
  return { paths, config: undefined };
}

async function setupVaultWithEntry(root: string): Promise<AppPaths> {
  const paths = tempPaths(root);
  await initializeVault(paths, { masterPassword: "correct-horse" });

  const identityPlain = await unwrapIdentityWithPassword(
    "correct-horse",
    paths.wrappedIdentityPath,
  );
  try {
    await openSession(paths, identityPlain, 15);
    await createEntry(paths, identityPlain, {
      title: "Maintenance Fixture",
      category: "note",
      content: "fixture content",
      tags: ["it4"],
    });
  } finally {
    identityPlain.fill(0);
  }

  return paths;
}

async function captureConsole(
  fn: () => Promise<void>,
): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdout.push(args.join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    stderr.push(args.join(" "));
  });

  try {
    await fn();
    return {
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
    };
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

describe("maintenance command integration", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) =>
        fs.rm(root, { recursive: true, force: true }).catch(() => {}),
      ),
    );
  });

  it("supports backup verify/restore JSON output and logs backup operations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-maint-backup-"));
    roots.push(root);
    const paths = await setupVaultWithEntry(root);
    const backupDir = path.join(root, "backup-out");
    const restoreDir = path.join(root, "restore-out");

    await createBackup(paths, { outputDir: backupDir });

    const verifyOutput = await captureConsole(() =>
      runBackupCommand(context(paths), ["verify", "--dir", backupDir, "--json"]),
    );
    const verifyJson = JSON.parse(verifyOutput.stdout);
    expect(verifyJson.version).toBe(1);
    expect(verifyJson.status).toBe("valid");
    expect(verifyJson.totalFiles).toBeGreaterThan(0);
    expect(Array.isArray(verifyJson.errors)).toBe(true);

    const restoreOutput = await captureConsole(() =>
      runBackupCommand(context(paths), [
        "restore",
        "--from",
        backupDir,
        "--output",
        restoreDir,
        "--dry-run",
        "--json",
      ]),
    );
    const restoreJson = JSON.parse(restoreOutput.stdout);
    expect(restoreJson.version).toBe(1);
    expect(restoreJson.dryRun).toBe(true);
    expect(restoreJson.targetRoot).toBe(path.resolve(restoreDir));
    expect(restoreJson.totalFiles).toBeGreaterThan(0);
    expect(Array.isArray(restoreJson.files)).toBe(true);

    const logs = await readOperationLog(paths);
    expect(
      logs.some(
        (entry) =>
          entry.command === "backup" &&
          entry.subcommand === "create" &&
          entry.result === "success",
      ),
    ).toBe(true);
    expect(
      logs.some(
        (entry) =>
          entry.command === "backup" &&
          entry.subcommand === "restore" &&
          entry.result === "success" &&
          entry.summary.includes("dry-run"),
      ),
    ).toBe(true);
  });

  it("supports import JSON output and records both success and failure logs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-maint-import-"));
    roots.push(root);
    const paths = await setupVaultWithEntry(root);
    const exportDir = path.join(root, "export-json");

    const identityPlain = await unwrapIdentityWithPassword(
      "correct-horse",
      paths.wrappedIdentityPath,
    );
    await exportEntries(paths, identityPlain, {
      all: true,
      format: "json",
      outputDir: exportDir,
    });

    const successOutput = await captureConsole(() =>
      runImportCommand(context(paths), [
        "--format",
        "json",
        "--input",
        exportDir,
        "--json",
      ]),
    );
    const successJson = JSON.parse(successOutput.stdout);
    expect(successJson.version).toBe(1);
    expect(successJson.success).toBeGreaterThan(0);
    expect(successJson.conflict).toBe(0);

    const missingDir = path.join(root, "missing-import");
    const failOutput = await captureConsole(() =>
      runImportCommand(context(paths), [
        "--format",
        "json",
        "--input",
        missingDir,
        "--json",
      ]),
    );
    const failJson = JSON.parse(failOutput.stdout);
    expect(failJson.version).toBe(1);
    expect(failJson.status).toBe("error");
    expect(failJson.error.code).toBe("INVALID_ARGS");
    expect(failJson.error.retryable).toBe(false);
    expect(failJson.error.message).toContain("Import directory not found");

    const logs = await readOperationLog(paths);
    expect(
      logs.some(
        (entry) =>
          entry.command === "import" &&
          entry.result === "success" &&
          entry.targetPath === path.resolve(exportDir),
      ),
    ).toBe(true);
    expect(
      logs.some(
        (entry) =>
          entry.command === "import" &&
          entry.result === "failed" &&
          entry.targetPath === path.resolve(missingDir),
      ),
    ).toBe(true);
  });

  it("supports doctor cleanup JSON output and records dry-run and apply logs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-maint-clean-"));
    roots.push(root);
    const paths = await setupVaultWithEntry(root);
    await fs.writeFile(path.join(paths.entriesDir, "orphan.age"), "orphan", "utf8");

    const dryRunOutput = await captureConsole(() =>
      runDoctorCommand(context(paths), ["cleanup", "--json"]),
    );
    const dryRunJson = JSON.parse(dryRunOutput.stdout);
    expect(dryRunJson.version).toBe(1);
    expect(dryRunJson.dryRun).toBe(true);
    expect(dryRunJson.totalActions).toBe(1);
    expect(dryRunJson.actions[0].action).toBe("delete_orphan_entry_file");

    const applyOutput = await captureConsole(() =>
      runDoctorCommand(context(paths), ["cleanup", "--apply", "--json"]),
    );
    const applyJson = JSON.parse(applyOutput.stdout);
    expect(applyJson.applied).toBe(true);
    expect(applyJson.dryRun).toBe(false);

    const logs = await readOperationLog(paths);
    expect(
      logs.some(
        (entry) =>
          entry.command === "doctor" &&
          entry.subcommand === "cleanup" &&
          entry.result === "success" &&
          entry.summary.includes("dry-run"),
      ),
    ).toBe(true);
    expect(
      logs.some(
        (entry) =>
          entry.command === "doctor" &&
          entry.subcommand === "cleanup" &&
          entry.result === "success" &&
          entry.summary.includes("apply"),
      ),
    ).toBe(true);
  });

  it("rejects unknown maintenance flags with INVALID_ARGS semantics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-maint-args-"));
    roots.push(root);
    const paths = await setupVaultWithEntry(root);

    await expect(
      runBackupCommand(context(paths), ["verify", "--dir", root, "--bogus"]),
    ).rejects.toThrow(/Unknown option/);

    await expect(
      runDoctorCommand(context(paths), ["cleanup", "--bogus"]),
    ).rejects.toThrow(/Unknown option/);

    await expect(
      runImportCommand(context(paths), ["--bogus"]),
    ).rejects.toThrow(/Unknown option/);
  });
});
