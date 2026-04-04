import fs from "node:fs/promises";

import { CerberusError, ErrorCode } from "./errors.js";
import type { AppPaths, CerberusConfig } from "./types.js";

export function createDefaultConfig(): CerberusConfig {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    sessionTtlMinutes: 15,
  };
}

export type { CerberusConfig };

export function validateConfig(raw: unknown): CerberusConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new CerberusError(
      "Invalid config: expected an object",
      ErrorCode.CONFIG_ERROR,
    );
  }

  const cfg = raw as Record<string, unknown>;

  if (cfg.version !== 1) {
    throw new CerberusError(
      `Unsupported config version: ${cfg.version}`,
      ErrorCode.CONFIG_ERROR,
    );
  }

  if (typeof cfg.createdAt !== "string") {
    throw new CerberusError(
      "Invalid config: createdAt must be an ISO string",
      ErrorCode.CONFIG_ERROR,
    );
  }

  if (typeof cfg.sessionTtlMinutes !== "number" || cfg.sessionTtlMinutes < 1) {
    throw new CerberusError(
      "Invalid config: sessionTtlMinutes must be a positive number",
      ErrorCode.CONFIG_ERROR,
    );
  }

  return {
    version: cfg.version,
    createdAt: cfg.createdAt,
    sessionTtlMinutes: cfg.sessionTtlMinutes,
  };
}

export async function loadConfig(appPaths: AppPaths): Promise<CerberusConfig> {
  const raw = await fs.readFile(appPaths.configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CerberusError(
      "Config file is not valid JSON",
      ErrorCode.CONFIG_ERROR,
    );
  }
  return validateConfig(parsed);
}

export async function saveConfig(
  appPaths: AppPaths,
  config: CerberusConfig,
): Promise<void> {
  const json = JSON.stringify(config, null, 2) + "\n";
  await fs.writeFile(appPaths.configPath, json, "utf8");
}
