import { CerberusError, ErrorCode } from "../core/errors.js";
import { isVaultInitialized } from "../core/paths.js";
import { importPlaintextEntries } from "../services/import-service.js";
import type { AppContext } from "../core/types.js";
import { requireSession } from "./unlock.js";

const VALID_FORMATS = ["json", "markdown"] as const;

interface ImportArgs {
  format: "json" | "markdown";
  inputDir?: string;
  json: boolean;
}

function parseImportArgs(args: string[]): ImportArgs {
  const result: ImportArgs = {
    format: "json",
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--format" || arg === "-f") {
      const val = args[++i];
      if (!val) {
        throw new CerberusError(
          "Missing value for --format",
          ErrorCode.INVALID_ARGS,
        );
      }
      if (!VALID_FORMATS.includes(val as (typeof VALID_FORMATS)[number])) {
        throw new CerberusError(
          `Invalid format. Valid: ${VALID_FORMATS.join(", ")}`,
          ErrorCode.INVALID_ARGS,
        );
      }
      result.format = val as "json" | "markdown";
    } else if (arg === "--input" || arg === "-i" || arg === "--dir") {
      const val = args[++i];
      if (!val) {
        throw new CerberusError(
          "Missing value for --input",
          ErrorCode.INVALID_ARGS,
        );
      }
      result.inputDir = val;
    } else if (arg === "--json") {
      result.json = true;
    }
  }

  return result;
}

export async function runImportCommand(
  context: AppContext,
  args: string[],
): Promise<void> {
  const { paths } = context;

  if (!(await isVaultInitialized(paths))) {
    throw new CerberusError(
      "Vault is not initialized. Run `cerberus init` first.",
      ErrorCode.VAULT_NOT_FOUND,
    );
  }

  const parsed = parseImportArgs(args);

  if (!parsed.inputDir) {
    throw new CerberusError(
      "Missing --input <dir>. Usage: cerberus import --format json|markdown --input <dir>",
      ErrorCode.INVALID_ARGS,
    );
  }

  const identityPlain = await requireSession(paths);

  const stats = await importPlaintextEntries(paths, identityPlain, {
    format: parsed.format,
    inputDir: parsed.inputDir,
  });

  if (parsed.json) {
    const output = {
      version: 1,
      success: stats.success,
      skipped: stats.skipped,
      conflict: stats.conflict,
      summary: `Import finished: success: ${stats.success}, skipped: ${stats.skipped}, conflict: ${stats.conflict}`,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(
    [
      "Import finished:",
      `  success: ${stats.success}`,
      `  skipped: ${stats.skipped}`,
      `  conflict: ${stats.conflict}`,
    ].join("\n"),
  );
}
