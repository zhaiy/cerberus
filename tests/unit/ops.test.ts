import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OperationLogEntry } from "../../src/core/operation-log.js";
import {
  appendOperationLog,
  createOperationLogEntry,
  filterOperationLog,
  findOperationById,
} from "../../src/core/operation-log.js";
import { runOpsCommand } from "../../src/commands/ops.js";
import type { AppPaths } from "../../src/core/types.js";

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

function makeEntry(overrides: Partial<OperationLogEntry> = {}): OperationLogEntry {
  return {
    id: `op_test_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    command: "backup",
    subcommand: "create",
    result: "success",
    summary: "Backup created",
    ...overrides,
  };
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
    return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

// ── filterOperationLog ──────────────────────────────────────────────

describe("filterOperationLog", () => {
  const entries: OperationLogEntry[] = [
    makeEntry({ command: "backup", subcommand: "create", result: "success" }),
    makeEntry({ command: "backup", subcommand: "restore", result: "failed" }),
    makeEntry({ command: "import", result: "success" }),
    makeEntry({ command: "doctor", subcommand: "cleanup", result: "success" }),
    makeEntry({ command: "import", result: "failed" }),
  ];

  it("returns all entries when no filters applied", () => {
    expect(filterOperationLog(entries, {})).toHaveLength(5);
  });

  it("filters by command", () => {
    const result = filterOperationLog(entries, { command: "backup" });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.command === "backup")).toBe(true);
  });

  it("filters by result", () => {
    const result = filterOperationLog(entries, { result: "failed" });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.result === "failed")).toBe(true);
  });

  it("filters by last N", () => {
    const result = filterOperationLog(entries, { last: 2 });
    expect(result).toHaveLength(2);
    // Should be the last 2 entries (most recent)
    expect(result[0].command).toBe("doctor");
    expect(result[1].command).toBe("import");
  });

  it("combines filters", () => {
    const result = filterOperationLog(entries, {
      command: "import",
      result: "success",
    });
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe("import");
    expect(result[0].result).toBe("success");
  });

  it("returns empty for non-matching filter", () => {
    const result = filterOperationLog(entries, { command: "nonexistent" });
    expect(result).toHaveLength(0);
  });
});

// ── findOperationById ───────────────────────────────────────────────

describe("findOperationById", () => {
  it("finds entry by id", () => {
    const entries = [
      makeEntry({ id: "op_abc" }),
      makeEntry({ id: "op_def" }),
    ];
    const found = findOperationById(entries, "op_abc");
    expect(found).toBeDefined();
    expect(found!.id).toBe("op_abc");
  });

  it("returns undefined for missing id", () => {
    const entries = [makeEntry({ id: "op_abc" })];
    expect(findOperationById(entries, "op_missing")).toBeUndefined();
  });
});

// ── ops command ─────────────────────────────────────────────────────

describe("ops command", () => {
  let root: string;
  let paths: AppPaths;
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true }).catch(() => {})),
    );
  });

  async function setupWithLogs(): Promise<AppPaths> {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-ops-"));
    roots.push(root);
    paths = tempPaths(root);
    await fs.mkdir(paths.appDir, { recursive: true });

    await appendOperationLog(paths, createOperationLogEntry({
      command: "backup",
      subcommand: "create",
      result: "success",
      summary: "Backup created: 5 file(s)",
      durationMs: 100,
    }));
    await appendOperationLog(paths, createOperationLogEntry({
      command: "import",
      result: "failed",
      summary: "Import failed: IO error",
      error: "directory not found",
    }));

    return paths;
  }

  it("ops list outputs text format by default", async () => {
    const p = await setupWithLogs();
    const output = await captureConsole(() =>
      runOpsCommand({ paths: p, config: undefined }, ["list"]),
    );
    expect(output.stdout).toContain("backup create");
    expect(output.stdout).toContain("success");
    expect(output.stdout).toContain("import");
    expect(output.stdout).toContain("failed");
  });

  it("ops list --json outputs structured JSON", async () => {
    const p = await setupWithLogs();
    const output = await captureConsole(() =>
      runOpsCommand({ paths: p, config: undefined }, ["list", "--json"]),
    );
    const json = JSON.parse(output.stdout);
    expect(json.version).toBe(1);
    expect(json.total).toBe(2);
    expect(json.operations).toHaveLength(2);
    // targetPath must not be present
    for (const op of json.operations) {
      expect(op).not.toHaveProperty("targetPath");
    }
  });

  it("ops list filters by --command", async () => {
    const p = await setupWithLogs();
    const output = await captureConsole(() =>
      runOpsCommand({ paths: p, config: undefined }, ["list", "--command", "backup", "--json"]),
    );
    const json = JSON.parse(output.stdout);
    expect(json.total).toBe(1);
    expect(json.operations[0].command).toBe("backup");
  });

  it("ops list filters by --result", async () => {
    const p = await setupWithLogs();
    const output = await captureConsole(() =>
      runOpsCommand({ paths: p, config: undefined }, ["list", "--result", "failed", "--json"]),
    );
    const json = JSON.parse(output.stdout);
    expect(json.total).toBe(1);
    expect(json.operations[0].result).toBe("failed");
  });

  it("ops list filters by --last", async () => {
    const p = await setupWithLogs();
    const output = await captureConsole(() =>
      runOpsCommand({ paths: p, config: undefined }, ["list", "--last", "1", "--json"]),
    );
    const json = JSON.parse(output.stdout);
    expect(json.total).toBe(1);
  });

  it("ops show shows a specific entry", async () => {
    const p = await setupWithLogs();
    const logs = await (async () => {
      const content = await fs.readFile(path.join(p.appDir, "operations.log"), "utf8");
      return content.trim().split("\n").map((l) => JSON.parse(l));
    })();
    const targetId = logs[0].id;

    const output = await captureConsole(() =>
      runOpsCommand({ paths: p, config: undefined }, ["show", targetId]),
    );
    expect(output.stdout).toContain(targetId);
    expect(output.stdout).toContain("backup");
    expect(output.stdout).toContain("success");
  });

  it("ops show --json outputs structured JSON", async () => {
    const p = await setupWithLogs();
    const logs = await (async () => {
      const content = await fs.readFile(path.join(p.appDir, "operations.log"), "utf8");
      return content.trim().split("\n").map((l) => JSON.parse(l));
    })();
    const targetId = logs[0].id;

    const output = await captureConsole(() =>
      runOpsCommand({ paths: p, config: undefined }, ["show", targetId, "--json"]),
    );
    const json = JSON.parse(output.stdout);
    expect(json.version).toBe(1);
    expect(json.id).toBe(targetId);
    expect(json).not.toHaveProperty("targetPath");
  });

  it("ops show with invalid ID outputs error envelope in JSON mode", async () => {
    const p = await setupWithLogs();
    const output = await captureConsole(() =>
      runOpsCommand({ paths: p, config: undefined }, ["show", "op_nonexistent", "--json"]),
    );
    const json = JSON.parse(output.stdout);
    expect(json.version).toBe(1);
    expect(json.status).toBe("error");
    expect(json.error.code).toBe("INVALID_ARGS");
    expect(json.error.message).toContain("not found");
    expect(process.exitCode).toBe(2);
    process.exitCode = 0; // reset for other tests
  });

  it("ops list on empty log returns no operations", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-ops-empty-"));
    roots.push(root);
    paths = tempPaths(root);
    await fs.mkdir(paths.appDir, { recursive: true });

    const output = await captureConsole(() =>
      runOpsCommand({ paths, config: undefined }, ["list", "--json"]),
    );
    const json = JSON.parse(output.stdout);
    expect(json.total).toBe(0);
    expect(json.operations).toHaveLength(0);
  });

  it("rejects unknown ops subcommand", async () => {
    const p = await setupWithLogs();
    await expect(
      runOpsCommand({ paths: p, config: undefined }, ["unknown"]),
    ).rejects.toThrow(/Unknown ops subcommand/);
  });

  it("rejects invalid --result value", async () => {
    const p = await setupWithLogs();
    await expect(
      runOpsCommand({ paths: p, config: undefined }, ["list", "--result", "invalid"]),
    ).rejects.toThrow(/Invalid --result/);
  });
});
