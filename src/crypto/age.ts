import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CerberusError, ErrorCode } from "../core/errors.js";

export interface EncryptFileOptions {
  inputPath: string;
  outputPath: string;
  recipient: string;
}

export interface DecryptFileOptions {
  inputPath: string;
  outputPath: string;
  identityPath: string;
}

function runProcess(
  cmd: string,
  args: string[],
  stdin?: Buffer,
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (c: Buffer) => stdout.push(c));
    child.stderr?.on("data", (c: Buffer) => stderr.push(c));
    child.on("error", () => {
      reject(
        new CerberusError(
          "Encryption tools are not available.",
          ErrorCode.UNKNOWN,
        ),
      );
    });
    child.on("close", (code) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      if (code === 0) {
        resolve({ stdout: out, stderr: err });
        return;
      }
      reject(
        new CerberusError(
          "Encryption operation failed.",
          ErrorCode.UNKNOWN,
        ),
      );
    });
    if (stdin && child.stdin) {
      child.stdin.end(stdin);
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}

/**
 * Generate a new age identity; private key material is returned only in memory.
 * Writes to a temp file (not `-o -`) so a stray file named `-` in cwd cannot break keygen,
 * and non-interactive environments do not hang waiting for a TTY.
 */
export async function generateIdentityToBuffer(): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-age-"));
  const keyPath = path.join(tmpDir, "identity.txt");
  try {
    await runProcess("age-keygen", ["-o", keyPath]);
    return await fs.readFile(keyPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function encryptFile(options: EncryptFileOptions): Promise<void> {
  await runProcess("age", [
    "-e",
    "-r",
    options.recipient,
    "-o",
    options.outputPath,
    options.inputPath,
  ]);
}

export async function decryptFile(options: DecryptFileOptions): Promise<void> {
  await runProcess("age", [
    "-d",
    "-i",
    options.identityPath,
    "-o",
    options.outputPath,
    options.inputPath,
  ]);
}

// ── Buffer-based operations (avoid writing plaintext to disk) ──

/**
 * Extract the age public key (recipient) from an identity file's content.
 * The identity format includes a comment line: `# public key: age1...`
 */
export function extractPublicKey(identity: Buffer): string {
  const text = identity.toString("utf8");
  for (const line of text.split("\n")) {
    if (line.startsWith("# public key: ")) {
      return line.slice("# public key: ".length).trim();
    }
  }
  throw new CerberusError(
    "Could not extract public key from identity.",
    ErrorCode.UNKNOWN,
  );
}

/**
 * Encrypt a buffer in memory using age. Plaintext is piped via stdin;
 * ciphertext is collected from stdout — no files touch disk.
 */
export async function encryptBuffer(
  plaintext: Buffer,
  recipient: string,
): Promise<Buffer> {
  const { stdout } = await runProcess(
    "age",
    ["-e", "-r", recipient, "-o", "-"],
    plaintext,
  );
  return stdout;
}

/**
 * Decrypt a ciphertext buffer using an identity file on disk.
 * Ciphertext is piped via stdin; plaintext is collected from stdout.
 *
 * Note: age requires `-i <path>` for the identity — it cannot read from stdin.
 * The caller is responsible for managing the temp identity file.
 */
export async function decryptBuffer(
  ciphertext: Buffer,
  identityPath: string,
): Promise<Buffer> {
  const { stdout } = await runProcess(
    "age",
    ["-d", "-i", identityPath, "-o", "-"],
    ciphertext,
  );
  return stdout;
}
