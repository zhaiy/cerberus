import { CerberusError, ErrorCode } from "../core/errors.js";
import { isVaultInitialized } from "../core/paths.js";
import { closeSession, getActiveSession } from "../crypto/session.js";
import type { AppContext } from "../core/types.js";

export async function runLockCommand(
  context: AppContext,
  _args: string[],
): Promise<void> {
  const { paths } = context;

  if (!(await isVaultInitialized(paths))) {
    throw new CerberusError(
      "Vault is not initialized. Run `cerberus init` first.",
      ErrorCode.VAULT_NOT_FOUND,
    );
  }

  const session = await getActiveSession(paths);
  if (!session) {
    console.log("No active session. Vault is already locked.");
    return;
  }

  await closeSession(paths);
  console.log("Vault locked. Session cleared.");
}
