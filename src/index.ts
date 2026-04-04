import { createRequire } from "node:module";
import { CerberusError } from "./core/errors.js";
import { runCli } from "./cli/index.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

async function main(): Promise<void> {
  await runCli(process.argv.slice(2), version);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[cerberus] ${message}`);
  process.exitCode = error instanceof CerberusError ? error.exitCode : 1;
});

