import { CerberusError, ErrorCode } from "../core/errors.js";
import type { AppContext } from "../core/types.js";
import {
  createBackup,
  verifyBackup,
} from "../services/backup-service.js";

function parseBackupArgs(args: string[]): {
  subcommand: string;
  outputDir?: string;
  backupDir?: string;
} {
  if (args.length === 0) {
    throw new CerberusError(
      "Usage: cerberus backup <create|verify> ...",
      ErrorCode.INVALID_ARGS,
    );
  }

  const subcommand = args[0];
  let outputDir: string | undefined;
  let backupDir: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--output" || args[i] === "-o") {
      const val = args[i + 1];
      if (!val) {
        throw new CerberusError(
          "Missing value for --output",
          ErrorCode.INVALID_ARGS,
        );
      }
      outputDir = val;
      i += 1;
    } else if (args[i] === "--dir" || args[i] === "-d") {
      const val = args[i + 1];
      if (!val) {
        throw new CerberusError(
          "Missing value for --dir",
          ErrorCode.INVALID_ARGS,
        );
      }
      backupDir = val;
      i += 1;
    }
  }

  return { subcommand, outputDir, backupDir };
}

export async function runBackupCommand(
  context: AppContext,
  args: string[],
): Promise<void> {
  const { subcommand, outputDir, backupDir } = parseBackupArgs(args);

  if (subcommand === "create") {
    if (!outputDir) {
      throw new CerberusError(
        "Missing --output <dir>. Usage: cerberus backup create --output <dir>",
        ErrorCode.INVALID_ARGS,
      );
    }
    await createBackup(context.paths, { outputDir });
    console.log(`Backup created at: ${outputDir}`);
    return;
  }

  if (subcommand === "verify") {
    const dir = backupDir ?? outputDir;
    if (!dir) {
      throw new CerberusError(
        "Missing --dir <path>. Usage: cerberus backup verify --dir <path>",
        ErrorCode.INVALID_ARGS,
      );
    }
    const result = await verifyBackup(dir);
    if (result.errors.length === 0) {
      console.log(
        `Backup verified: ${result.totalFiles} file(s) OK`,
      );
    } else {
      console.error("Backup verification failed:");
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      throw new CerberusError(
        "Backup verification failed.",
        ErrorCode.BACKUP_FAILED,
      );
    }
    return;
  }

  throw new CerberusError(
    `Unknown backup subcommand: ${subcommand}`,
    ErrorCode.INVALID_ARGS,
  );
}
