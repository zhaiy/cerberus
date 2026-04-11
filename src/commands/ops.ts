import { CerberusError, ErrorCode } from "../core/errors.js";
import { errorEnvelope } from "../core/json-envelope.js";
import {
  filterOperationLog,
  findOperationById,
  type OperationFilterOptions,
  type OperationLogEntry,
  readOperationLog,
} from "../core/operation-log.js";
import type { AppContext } from "../core/types.js";

// ── Argument parsing ────────────────────────────────────────────────

interface OpsListArgs {
  last: number;
  command?: string;
  result?: "success" | "failed";
  json: boolean;
}

interface OpsShowArgs {
  id: string;
  json: boolean;
}

function parseOpsArgs(
  args: string[],
): { subcommand: string; listArgs?: OpsListArgs; showArgs?: OpsShowArgs } {
  if (args.length === 0) {
    throw new CerberusError(
      "Usage: cerberus ops <list|show> ...",
      ErrorCode.INVALID_ARGS,
    );
  }

  const subcommand = args[0];

  if (subcommand === "list") {
    return { subcommand: "list", listArgs: parseListArgs(args.slice(1)) };
  }

  if (subcommand === "show") {
    return { subcommand: "show", showArgs: parseShowArgs(args.slice(1)) };
  }

  throw new CerberusError(
    `Unknown ops subcommand: ${subcommand}`,
    ErrorCode.INVALID_ARGS,
  );
}

function parseListArgs(args: string[]): OpsListArgs {
  let last = 20;
  let command: string | undefined;
  let result: "success" | "failed" | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--last") {
      const val = args[++i];
      if (!val || isNaN(Number(val))) {
        throw new CerberusError(
          "Missing or invalid value for --last",
          ErrorCode.INVALID_ARGS,
        );
      }
      last = Number(val);
    } else if (args[i] === "--command") {
      const val = args[++i];
      if (!val) {
        throw new CerberusError(
          "Missing value for --command",
          ErrorCode.INVALID_ARGS,
        );
      }
      command = val;
    } else if (args[i] === "--result") {
      const val = args[++i];
      if (!val) {
        throw new CerberusError(
          "Missing value for --result",
          ErrorCode.INVALID_ARGS,
        );
      }
      if (val !== "success" && val !== "failed") {
        throw new CerberusError(
          "Invalid --result value. Use: success, failed",
          ErrorCode.INVALID_ARGS,
        );
      }
      result = val;
    } else if (args[i] === "--json") {
      json = true;
    } else if (args[i]?.startsWith("-")) {
      throw new CerberusError(
        `Unknown option for ops list: ${args[i]}`,
        ErrorCode.INVALID_ARGS,
      );
    }
  }

  return { last, command, result, json };
}

function parseShowArgs(args: string[]): OpsShowArgs {
  let json = false;
  let id: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") {
      json = true;
    } else if (args[i]?.startsWith("-")) {
      throw new CerberusError(
        `Unknown option for ops show: ${args[i]}`,
        ErrorCode.INVALID_ARGS,
      );
    } else if (!id) {
      id = args[i];
    }
  }

  if (!id) {
    throw new CerberusError(
      "Missing operation ID. Usage: cerberus ops show <id> [--json]",
      ErrorCode.INVALID_ARGS,
    );
  }

  return { id, json };
}

// ── Output formatting ───────────────────────────────────────────────

/** Strip targetPath from an entry for safe output */
function safeEntry(
  entry: OperationLogEntry,
): Omit<OperationLogEntry, "targetPath"> {
  const { targetPath: _, ...safe } = entry;
  return safe;
}

function formatListText(entries: OperationLogEntry[]): string {
  if (entries.length === 0) {
    return "No operations found.";
  }

  const lines: string[] = [];
  for (const e of entries) {
    const cmd = e.subcommand ? `${e.command} ${e.subcommand}` : e.command;
    lines.push(
      `${e.id}  ${e.timestamp}  ${cmd}  ${e.result}  ${e.summary}`,
    );
  }
  return lines.join("\n");
}

function formatListJson(entries: OperationLogEntry[]): string {
  const safe = entries.map(safeEntry);
  return JSON.stringify(
    {
      version: 1,
      total: safe.length,
      operations: safe,
    },
    null,
    2,
  );
}

function formatShowText(entry: OperationLogEntry): string {
  const cmd = entry.subcommand
    ? `${entry.command} ${entry.subcommand}`
    : entry.command;
  const lines = [
    `Operation:  ${entry.id}`,
    `Timestamp:  ${entry.timestamp}`,
    `Command:    ${cmd}`,
    `Result:     ${entry.result}`,
    `Summary:    ${entry.summary}`,
  ];
  if (entry.durationMs !== undefined) {
    lines.push(`Duration:   ${entry.durationMs}ms`);
  }
  if (entry.error) {
    lines.push(`Error:      ${entry.error}`);
  }
  return lines.join("\n");
}

function formatShowJson(entry: OperationLogEntry): string {
  return JSON.stringify(
    {
      version: 1,
      ...safeEntry(entry),
    },
    null,
    2,
  );
}

// ── Command entry point ─────────────────────────────────────────────

export async function runOpsCommand(
  context: AppContext,
  args: string[],
): Promise<void> {
  const { subcommand, listArgs, showArgs } = parseOpsArgs(args);

  try {
    const entries = await readOperationLog(context.paths);

    if (subcommand === "list" && listArgs) {
      const filterOptions: OperationFilterOptions = {};
      if (listArgs.last > 0) filterOptions.last = listArgs.last;
      if (listArgs.command) filterOptions.command = listArgs.command;
      if (listArgs.result) filterOptions.result = listArgs.result;

      const filtered = filterOperationLog(entries, filterOptions);

      if (listArgs.json) {
        console.log(formatListJson(filtered));
      } else {
        console.log(formatListText(filtered));
      }
      return;
    }

    if (subcommand === "show" && showArgs) {
      const entry = findOperationById(entries, showArgs.id);
      if (!entry) {
        const err = new CerberusError(
          `Operation not found: ${showArgs.id}`,
          ErrorCode.INVALID_ARGS,
        );
        if (showArgs.json) {
          console.log(JSON.stringify(errorEnvelope(err), null, 2));
          process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }

      if (showArgs.json) {
        console.log(formatShowJson(entry));
      } else {
        console.log(formatShowText(entry));
      }
      return;
    }
  } catch (error: unknown) {
    // For JSON mode, output error envelope; otherwise re-throw
    const isJson =
      (listArgs?.json ?? false) || (showArgs?.json ?? false);
    if (isJson && error instanceof CerberusError) {
      console.log(JSON.stringify(errorEnvelope(error), null, 2));
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}
