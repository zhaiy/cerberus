import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";

import { resolveAppPaths } from "../../src/core/paths.js";

describe("resolveAppPaths", () => {
  it("uses ~/.cerberus by default", () => {
    const paths = resolveAppPaths();
    expect(paths.homeDir).toBe(os.homedir());
    expect(paths.appDir).toBe(path.join(os.homedir(), ".cerberus"));
    expect(paths.vaultDir).toBe(path.join(os.homedir(), ".cerberus", "vault"));
  });

  it("supports overriding the home directory", () => {
    const paths = resolveAppPaths({ homeDir: "/tmp/cerberus-home" });
    expect(paths.homeDir).toBe("/tmp/cerberus-home");
    expect(paths.appDir).toBe("/tmp/cerberus-home/.cerberus");
    expect(paths.vaultDir).toBe("/tmp/cerberus-home/.cerberus/vault");
  });

  it("supports overriding the vault root directly", () => {
    const paths = resolveAppPaths({ appDir: "/tmp/custom-vault" });
    expect(paths.appDir).toBe("/tmp/custom-vault");
    expect(paths.vaultDir).toBe("/tmp/custom-vault/vault");
    expect(paths.configPath).toBe("/tmp/custom-vault/config.json");
  });
});
