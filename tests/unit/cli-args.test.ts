import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index.js";
import { runInitCommand } from "../../src/commands/init.js";
import { runUnlockCommand } from "../../src/commands/unlock.js";
import type { AppContext, AppPaths } from "../../src/core/types.js";

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

describe("CLI argument validation", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
      root = "";
    }
  });

  it("rejects unknown global options", async () => {
    await expect(runCli(["--bogus"], "0.1.0")).rejects.toThrow(
      /Unknown global option/,
    );
  });

  it("rejects unknown init options", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-init-args-"));
    const context: AppContext = {
      paths: tempPaths(root),
      config: undefined,
    };

    await expect(runInitCommand(context, ["--bogus"])).rejects.toThrow(
      /Unknown option for init/,
    );
  });

  it("rejects unknown unlock options", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-unlock-args-"));
    const context: AppContext = {
      paths: tempPaths(root),
      config: undefined,
    };

    await expect(runUnlockCommand(context, ["--bogus"])).rejects.toThrow(
      /Unknown option for unlock/,
    );
  });
});
