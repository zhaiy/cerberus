import { CerberusError, ErrorCode } from "../core/errors.js";
import { buildAppContext } from "../core/runtime.js";
import { runAttachCommand } from "../commands/attach.js";
import { runBackupCommand } from "../commands/backup.js";
import { runDoctorCommand } from "../commands/doctor.js";
import { runDeleteCommand } from "../commands/delete.js";
import { runEditCommand } from "../commands/edit.js";
import { runExportCommand } from "../commands/export.js";
import { runImportCommand } from "../commands/import.js";
import { runInitCommand } from "../commands/init.js";
import { runListCommand } from "../commands/list.js";
import { runLockCommand } from "../commands/lock.js";
import { runNewCommand } from "../commands/new.js";
import { runOpsCommand } from "../commands/ops.js";
import { runSearchCommand } from "../commands/search.js";
import { runShowCommand } from "../commands/show.js";
import { runUnlockCommand } from "../commands/unlock.js";

interface ParsedCliArgs {
  command?: string;
  commandArgs: string[];
  help: boolean;
  version: boolean;
  homeDir?: string;
  appDir?: string;
}

function renderHelp(): string {
  return [
    "Cerberus — Local-first encrypted private vault",
    "",
    "Usage:",
    "  cerberus [global-options] <command> [options]",
    "",
    "Commands:",
    "  init             Initialize the vault",
    "  unlock           Unlock the vault for the current session",
    "  lock             Lock the vault and clear the session",
    "  new              Create a new entry",
    "  list             List entries",
    "  show <entry-id>  Show an entry",
    "  edit <entry-id>  Edit an entry",
    "  delete <entry-id> Delete an entry",
    "  export           Export entries in plaintext",
    "  import           Import plaintext exports into the vault",
    "  doctor check     Check vault metadata vs ciphertext files",
    "  doctor cleanup   Conservatively remove orphan vault files / broken entries",
    "  search           Search entries by title or tag",
    "  attach           Manage attachments",
    "  backup create    Create a backup of the vault",
    "  backup verify    Verify a backup against its manifest",
    "  backup restore   Restore a verified backup to a new vault directory",
    "  ops list         List operation log entries",
    "  ops show <id>    Show a specific operation log entry",
    "",
    "Global Options:",
    "  --vault <path>  Use an explicit vault root instead of ~/.cerberus",
    "  --home <path>   Override the home directory used to resolve ~/.cerberus",
    "  -h, --help      Show this help message",
    "  -v, --version   Show version",
    "",
    "Command Notes:",
    "  init --password-stdin      Read password and confirmation from stdin",
    "  unlock --password-stdin    Read password from stdin",
    "  list/search/show --json    Output in JSON format",
    "  backup verify --json       Output verification result in JSON format",
    "  backup restore --json      Output restore plan in JSON format",
    "  import --json              Output import result in JSON format",
    "  doctor cleanup --json      Output cleanup plan/result in JSON format",
    "  ops list --json            List operation log entries in JSON format",
    "  ops show <id> --json       Show operation log entry in JSON format",
  ].join("\n");
}

function parseCliArgs(args: string[]): ParsedCliArgs {
  const result: ParsedCliArgs = {
    commandArgs: [],
    help: false,
    version: false,
  };

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      index += 1;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      result.version = true;
      index += 1;
      continue;
    }
    if (arg === "--vault") {
      const value = args[index + 1];
      if (!value) {
        throw new CerberusError(
          "Missing value for --vault",
          ErrorCode.INVALID_ARGS,
        );
      }
      result.appDir = value;
      index += 2;
      continue;
    }
    if (arg === "--home") {
      const value = args[index + 1];
      if (!value) {
        throw new CerberusError(
          "Missing value for --home",
          ErrorCode.INVALID_ARGS,
        );
      }
      result.homeDir = value;
      index += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CerberusError(
        `Unknown global option: ${arg}`,
        ErrorCode.INVALID_ARGS,
      );
    }
    result.command = arg;
    result.commandArgs = args.slice(index + 1);
    return result;
  }

  if (index < args.length && !result.command) {
    result.command = args[index];
    result.commandArgs = args.slice(index + 1);
  }

  return result;
}

export async function runCli(args: string[], version: string): Promise<void> {
  const parsed = parseCliArgs(args);

  if (args.length === 0 || parsed.help) {
    console.log(renderHelp());
    return;
  }

  if (parsed.version) {
    console.log(`cerberus v${version}`);
    return;
  }

  const command = parsed.command;
  if (!command) {
    throw new CerberusError("Missing command", ErrorCode.INVALID_ARGS);
  }

  const context = buildAppContext({
    homeDir: parsed.homeDir,
    appDir: parsed.appDir,
  });
  const rest = parsed.commandArgs;

  switch (command) {
    case "init":
      await runInitCommand(context, rest);
      return;
    case "unlock":
      await runUnlockCommand(context, rest);
      return;
    case "new":
      await runNewCommand(context, rest);
      return;
    case "list":
      await runListCommand(context, rest);
      return;
    case "lock":
      await runLockCommand(context, rest);
      return;
    case "show":
      await runShowCommand(context, rest);
      return;
    case "edit":
      await runEditCommand(context, rest);
      return;
    case "delete":
      await runDeleteCommand(context, rest);
      return;
    case "export":
      await runExportCommand(context, rest);
      return;
    case "import":
      await runImportCommand(context, rest);
      return;
    case "doctor":
      await runDoctorCommand(context, rest);
      return;
    case "search":
      await runSearchCommand(context, rest);
      return;
    case "attach":
      await runAttachCommand(context, rest);
      return;
    case "backup":
      await runBackupCommand(context, rest);
      return;
    case "ops":
      await runOpsCommand(context, rest);
      return;
    default:
      throw new CerberusError(`Unknown command: ${command}`);
  }
}
