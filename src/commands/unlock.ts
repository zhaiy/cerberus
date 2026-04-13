import { CerberusError, ErrorCode } from "../core/errors.js";
import { promptPassword, readPasswordFromStdin } from "../core/prompt.js";
import { isVaultInitialized } from "../core/paths.js";
import { loadConfig } from "../core/config.js";
import { unwrapIdentityWithPassword } from "../crypto/identity.js";
import {
  openSession,
  getActiveSession,
  closeSession,
  cleanExpiredSessions,
} from "../crypto/session.js";
import type { AppContext } from "../core/types.js";

function parseUnlockArgs(args: string[]): { passwordStdin: boolean } {
  let passwordStdin = false;

  for (const arg of args) {
    if (arg === "--password-stdin") {
      passwordStdin = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CerberusError(
        `Unknown option for unlock: ${arg}`,
        ErrorCode.INVALID_ARGS,
      );
    }
  }

  return { passwordStdin };
}

export async function runUnlockCommand(
  context: AppContext,
  args: string[],
): Promise<void> {
  const { paths } = context;
  const { passwordStdin } = parseUnlockArgs(args);

  if (!(await isVaultInitialized(paths))) {
    throw new CerberusError(
      "Vault is not initialized. Run `cerberus init` first.",
      ErrorCode.VAULT_NOT_FOUND,
    );
  }

  // Opportunistically clean stale sessions
  await cleanExpiredSessions(paths);

  // Check if already unlocked
  const existing = await getActiveSession(paths);
  if (existing) {
    const remainingMs = existing.expiresAt.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60_000);
    console.log(`Vault is already unlocked. Session expires in ${remainingMin}m.`);
    return;
  }

  // Load config for TTL
  const config = await loadConfig(paths);

  const password = passwordStdin
    ? await readPasswordFromStdin()
    : await promptPassword("Master password");

  let identityPlain: Buffer | undefined;
  try {
    identityPlain = await unwrapIdentityWithPassword(password, paths.wrappedIdentityPath);
  } catch (e) {
    if (e instanceof CerberusError) {
      throw new CerberusError(
        "Could not unlock protected key material.",
        ErrorCode.SESSION_LOCKED,
      );
    }
    throw e;
  }

  try {
    await openSession(paths, identityPlain, config.sessionTtlMinutes);
    console.log(
      `Vault unlocked. Session expires in ${config.sessionTtlMinutes}m.`,
    );
  } finally {
    if (identityPlain) {
      identityPlain.fill(0);
    }
  }
}

/**
 * Require an active session or exit with SESSION_LOCKED.
 * Intended for use by sensitive commands (new, show, edit, delete, etc.).
 */
export async function requireSession(
  paths: import("../core/types.js").AppPaths,
): Promise<Buffer> {
  const session = await getActiveSession(paths);
  if (!session) {
    throw new CerberusError(
      "Vault is locked. Run `cerberus unlock` first.",
      ErrorCode.SESSION_LOCKED,
    );
  }
  return session.identityPlain;
}
