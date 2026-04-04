import { CerberusError, ErrorCode } from "../core/errors.js";
import {
  promptPasswordWithConfirmation,
  readPasswordWithConfirmationFromStdin,
} from "../core/prompt.js";
import { getVaultInitState } from "../core/paths.js";
import type { AppContext } from "../core/types.js";
import { initializeVault } from "../services/vault-service.js";

function parseInitArgs(args: string[]): { passwordStdin: boolean } {
  return {
    passwordStdin: args.includes("--password-stdin"),
  };
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
