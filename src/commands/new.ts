import * as readline from "node:readline";

import { CerberusError, ErrorCode } from "../core/errors.js";
import { promptLine } from "../core/prompt.js";
import { isVaultInitialized } from "../core/paths.js";
import { requireSession } from "./unlock.js";
import { createEntry } from "../services/vault-service.js";
import type { AppContext, EntryCategory } from "../core/types.js";

const VALID_CATEGORIES: EntryCategory[] = [
  "diary",
  "note",
  "last_words",
  "collection",
  "secret",
];

function parseArgs(args: string[]): {
  title?: string;
  category?: string;
  tags?: string;
} {
  const result: { title?: string; category?: string; tags?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--title" && args[i + 1]) {
      result.title = args[++i];
    } else if (args[i] === "--category" && args[i + 1]) {
      result.category = args[++i];
    } else if (args[i] === "--tags" && args[i + 1]) {
      result.tags = args[++i];
    }
  }
  return result;
}

function readStdinContent(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("")));
  });
}

function readTtyContent(): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    console.log(
      "Enter content (Ctrl+D to finish):",
    );
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.on("line", (line) => lines.push(line));
    rl.on("close", () => resolve(lines.join("\n")));
  });
}

export async function runNewCommand(
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

  const identityPlain = await requireSession(paths);

  const parsed = parseArgs(args);

  const title = parsed.title ?? (await promptLine("Title"));
  if (!title) {
    throw new CerberusError("Title cannot be empty.", ErrorCode.INVALID_ARGS);
  }

  let category: EntryCategory;
  if (parsed.category) {
    if (!VALID_CATEGORIES.includes(parsed.category as EntryCategory)) {
      throw new CerberusError(
        `Invalid category. Valid: ${VALID_CATEGORIES.join(", ")}`,
        ErrorCode.INVALID_ARGS,
      );
    }
    category = parsed.category as EntryCategory;
  } else {
    const input = await promptLine(
      `Category (${VALID_CATEGORIES.join("/")})`,
    );
    if (!input || !VALID_CATEGORIES.includes(input as EntryCategory)) {
      throw new CerberusError(
        `Invalid category. Valid: ${VALID_CATEGORIES.join(", ")}`,
        ErrorCode.INVALID_ARGS,
      );
    }
    category = input as EntryCategory;
  }

  const content = process.stdin.isTTY
    ? await readTtyContent()
    : await readStdinContent();
  if (!content.trim()) {
    throw new CerberusError("Content cannot be empty.", ErrorCode.INVALID_ARGS);
  }

  const tags = parsed.tags
    ? parsed.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  try {
    const id = await createEntry(paths, identityPlain, {
      title,
      category,
      content,
      tags,
    });
    console.log(`Entry created: ${id}`);
  } finally {
    identityPlain.fill(0);
  }
}
