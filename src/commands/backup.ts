import { CerberusError, ErrorCode } from "../core/errors.js";
import type { AppContext } from "../core/types.js";
import {
  createBackup,
  restoreBackupWithLog,
  verifyBackup,
} from "../services/backup-service.js";

function parseBackupArgs(args: string[]): {
  subcommand: string;
  outputDir?: string;
  backupDir?: string;
  restoreFrom?: string;
  dryRun: boolean;
  json: boolean;
} {
  if (args.length === 0) {
    throw new CerberusError(
      "Usage: cerberus backup <create|verify|restore> ...",
      ErrorCode.INVALID_ARGS,
    );
  }

  const subcommand = args[0];
  let outputDir: string | undefined;
  let backupDir: string | undefined;
  let restoreFrom: string | undefined;
  let dryRun = false;
  let json = false;

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
    } else if (args[i] === "--from") {
      const val = args[i + 1];
      if (!val) {
        throw new CerberusError(
          "Missing value for --from",
          ErrorCode.INVALID_ARGS,
        );
      }
      restoreFrom = val;
      i += 1;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--json") {
      json = true;
    } else if (args[i]?.startsWith("-")) {
      throw new CerberusError(
        `Unknown option for backup ${subcommand}: ${args[i]}`,
        ErrorCode.INVALID_ARGS,
      );
    }
  }

  return { subcommand, outputDir, backupDir, restoreFrom, dryRun, json };
}

export async function runBackupCommand(
  context: AppContext,
  args: string[],
): Promise<void> {
  const { subcommand, outputDir, backupDir, restoreFrom, dryRun, json } =
    parseBackupArgs(args);

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
    if (json) {
      const output = {
        version: 1,
        status: result.errors.length === 0 ? "valid" : "invalid",
        totalFiles: result.totalFiles,
        errors: result.errors,
        summary:
          result.errors.length === 0
            ? `Backup verified: ${result.totalFiles} file(s) OK`
            : `Backup verification failed: ${result.errors.length} error(s)`,
      };
      console.log(JSON.stringify(output, null, 2));
      if (result.errors.length > 0) {
        throw new CerberusError(
          "Backup verification failed.",
          ErrorCode.BACKUP_FAILED,
        );
      }
    } else {
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
    }
    return;
  }

  if (subcommand === "restore") {
    if (!restoreFrom) {
      throw new CerberusError(
        "Missing --from <backup-dir>. Usage: cerberus backup restore --from <dir> --output <dir> [--dry-run]",
        ErrorCode.INVALID_ARGS,
      );
    }
    if (!outputDir) {
      throw new CerberusError(
        "Missing --output <dir>. Usage: cerberus backup restore --from <dir> --output <dir> [--dry-run]",
        ErrorCode.INVALID_ARGS,
      );
    }
    const plan = await restoreBackupWithLog(context.paths, {
      backupDir: restoreFrom,
      targetDir: outputDir,
      dryRun,
    });

    if (json) {
      const output = {
        version: 1,
        dryRun,
        backupRoot: plan.backupRoot,
        targetRoot: plan.targetRoot,
        totalFiles: plan.totalFiles,
        totalBytes: plan.totalBytes,
        files: plan.files,
        summary: dryRun
          ? `Restore plan (dry-run, no files written): ${plan.totalFiles} file(s), ${plan.totalBytes} bytes`
          : `Restore completed: ${plan.totalFiles} file(s), ${plan.totalBytes} bytes`,
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    const lines = [
      dryRun ? "Restore plan (dry-run, no files written):" : "Restored backup to:",
      `  backup (source): ${plan.backupRoot}`,
      `  target (vault root): ${plan.targetRoot}`,
      `  files: ${plan.totalFiles}`,
      `  total bytes: ${plan.totalBytes}`,
    ];
    if (dryRun) {
      for (const f of plan.files) {
        lines.push(`  - ${f.relativePath} (${f.sizeBytes} bytes)`);
      }
    }
    console.log(lines.join("\n"));
    return;
  }

  throw new CerberusError(
    `Unknown backup subcommand: ${subcommand}`,
    ErrorCode.INVALID_ARGS,
  );
}
