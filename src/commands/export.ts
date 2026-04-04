import { CerberusError, ErrorCode } from "../core/errors.js";
import { isVaultInitialized } from "../core/paths.js";
import { requireSession } from "./unlock.js";
import { exportEntries } from "../services/export-service.js";
import type { AppContext, EntryCategory } from "../core/types.js";

const VALID_CATEGORIES: EntryCategory[] = [
  "diary",
  "note",
  "last_words",
  "collection",
  "secret",
];

const VALID_FORMATS = ["json", "markdown"] as const;

interface ExportArgs {
  all: boolean;
  category?: EntryCategory;
  format: "json" | "markdown";
  outputDir?: string;
}

function parseExportArgs(args: string[]): ExportArgs {
  const result: ExportArgs = {
    all: false,
    format: "json",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--all") {
      result.all = true;
    } else if (arg === "--category" || arg === "-c") {
      const val = args[++i];
      if (!val) {
        throw new CerberusError(
          "Missing value for --category",
          ErrorCode.INVALID_ARGS,
        );
      }
      if (!VALID_CATEGORIES.includes(val as EntryCategory)) {
        throw new CerberusError(
          `Invalid category. Valid: ${VALID_CATEGORIES.join(", ")}`,
          ErrorCode.INVALID_ARGS,
        );
      }
      result.category = val as EntryCategory;
    } else if (arg === "--format" || arg === "-f") {
      const val = args[++i];
      if (!val) {
        throw new CerberusError(
          "Missing value for --format",
          ErrorCode.INVALID_ARGS,
        );
      }
      if (!VALID_FORMATS.includes(val as typeof VALID_FORMATS[number])) {
        throw new CerberusError(
          `Invalid format. Valid: ${VALID_FORMATS.join(", ")}`,
          ErrorCode.INVALID_ARGS,
        );
      }
      result.format = val as "json" | "markdown";
    } else if (arg === "--output" || arg === "-o") {
      const val = args[++i];
      if (!val) {
        throw new CerberusError(
          "Missing value for --output",
          ErrorCode.INVALID_ARGS,
        );
      }
      result.outputDir = val;
    }
  }

  return result;
}

export async function runExportCommand(
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

  const parsed = parseExportArgs(args);

  if (!parsed.all && !parsed.category) {
    throw new CerberusError(
      "Specify --all or --category <category>.",
      ErrorCode.INVALID_ARGS,
    );
  }

  if (!parsed.outputDir) {
    throw new CerberusError(
      "Missing --output <dir>. Usage: cerberus export --all --output <dir>",
      ErrorCode.INVALID_ARGS,
    );
  }

  const identityPlain = await requireSession(paths);

  const count = await exportEntries(paths, identityPlain, {
    all: parsed.all,
    category: parsed.category,
    format: parsed.format,
    outputDir: parsed.outputDir,
  });

  console.log(`Exported ${count} entry(ies) to: ${parsed.outputDir}`);
}
