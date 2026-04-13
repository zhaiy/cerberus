import { CerberusError, ErrorCode } from "../core/errors.js";
import {
  promptPasswordWithConfirmation,
  readPasswordWithConfirmationFromStdin,
} from "../core/prompt.js";
import { getVaultInitState } from "../core/paths.js";
import type { AppContext } from "../core/types.js";
import { initializeVault } from "../services/vault-service.js";

function parseInitArgs(args: string[]): { passwordStdin: boolean } {
  let passwordStdin = false;

  for (const arg of args) {
    if (arg === "--password-stdin") {
      passwordStdin = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CerberusError(
        `Unknown option for init: ${arg}`,
        ErrorCode.INVALID_ARGS,
      );
    }
  }

  return { passwordStdin };
}

export async function runInitCommand(
  context: AppContext,
  args: string[],
): Promise<void> {
  const { paths } = context;
  const { passwordStdin } = parseInitArgs(args);

  const state = await getVaultInitState(paths);
  if (state === "complete") {
    throw new CerberusError(
      "Vault is already initialized.",
      ErrorCode.VAULT_ALREADY_EXISTS,
    );
  }
  if (state === "partial") {
    throw new CerberusError(
      "Vault data exists but is incomplete. Back up anything you need, remove the vault directory, and run init again.",
      ErrorCode.VAULT_STATE_INVALID,
    );
  }

  const masterPassword = passwordStdin
    ? await readPasswordWithConfirmationFromStdin()
    : await promptPasswordWithConfirmation();

  try {
    await initializeVault(paths, { masterPassword });
  } catch (e) {
    if (e instanceof CerberusError) {
      throw e;
    }
    throw new CerberusError(
      "Vault initialization failed.",
      ErrorCode.UNKNOWN,
    );
  }

  console.log("Vault initialized.");
  console.log("The encryption key is stored protected on disk.");
}
