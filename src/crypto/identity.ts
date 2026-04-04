import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import argon2 from "argon2";

import { CerberusError, ErrorCode } from "../core/errors.js";
import { generateIdentityToBuffer } from "./age.js";

const MAGIC = Buffer.from("CERB", "ascii");
const FORMAT_VERSION = 1;
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Fixed Argon2id parameters (must match unwrap). */
const ARGON2_MEMORY_COST = 19456;
const ARGON2_TIME_COST = 2;
const ARGON2_PARALLELISM = 1;

function zeroBuffer(buf: Buffer): void {
  buf.fill(0);
}

async function deriveWrapKey(
  password: string,
  salt: Buffer,
): Promise<Buffer> {
  const key = await argon2.hash(password, {
    type: argon2.argon2id,
    raw: true,
    hashLength: KEY_LENGTH,
    salt,
    memoryCost: ARGON2_MEMORY_COST,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });
  return key as Buffer;
}

/**
 * Wrap age identity bytes with Argon2id-derived AES-256-GCM key; does not write plaintext to disk.
 */
export async function wrapIdentityWithPassword(
  identityPlain: Buffer,
  password: string,
  outputPath: string,
): Promise<void> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const nonce = crypto.randomBytes(NONCE_LENGTH);
  let wrapKey: Buffer | undefined;
  try {
    wrapKey = await deriveWrapKey(password, salt);
    const cipher = crypto.createCipheriv("aes-256-gcm", wrapKey, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(identityPlain),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([ciphertext, tag]);

    const header = Buffer.allocUnsafe(4 + 1 + SALT_LENGTH + NONCE_LENGTH);
    MAGIC.copy(header, 0);
    header[4] = FORMAT_VERSION;
    salt.copy(header, 5);
    nonce.copy(header, 5 + SALT_LENGTH);

    await fs.writeFile(outputPath, Buffer.concat([header, payload]), {
      mode: 0o600,
    });
  } catch (e) {
    if (e instanceof CerberusError) {
      throw e;
    }
    throw new CerberusError(
      "Could not protect the encryption key.",
      ErrorCode.UNKNOWN,
    );
  } finally {
    if (wrapKey) {
      zeroBuffer(wrapKey);
    }
  }
}

/**
 * Read wrapped identity from disk and decrypt using the master password.
 */
export async function unwrapIdentityWithPassword(
  password: string,
  inputPath: string,
): Promise<Buffer> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(inputPath);
  } catch {
    throw new CerberusError(
      "Could not read protected key material.",
      ErrorCode.UNKNOWN,
    );
  }

  const minSize =
    MAGIC.length + 1 + SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH;
  if (raw.length < minSize) {
    throw new CerberusError(
      "Protected key material is invalid.",
      ErrorCode.UNKNOWN,
    );
  }

  if (!raw.subarray(0, 4).equals(MAGIC) || raw[4] !== FORMAT_VERSION) {
    throw new CerberusError(
      "Protected key material is invalid.",
      ErrorCode.UNKNOWN,
    );
  }

  const salt = raw.subarray(5, 5 + SALT_LENGTH);
  const nonce = raw.subarray(
    5 + SALT_LENGTH,
    5 + SALT_LENGTH + NONCE_LENGTH,
  );
  const payload = raw.subarray(5 + SALT_LENGTH + NONCE_LENGTH);
  if (payload.length < TAG_LENGTH) {
    throw new CerberusError(
      "Protected key material is invalid.",
      ErrorCode.UNKNOWN,
    );
  }

  const tag = payload.subarray(payload.length - TAG_LENGTH);
  const ciphertext = payload.subarray(0, payload.length - TAG_LENGTH);

  let wrapKey: Buffer | undefined;
  try {
    wrapKey = await deriveWrapKey(password, salt);
    const decipher = crypto.createDecipheriv("aes-256-gcm", wrapKey, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new CerberusError(
      "Could not unlock protected key material.",
      ErrorCode.UNKNOWN,
    );
  } finally {
    if (wrapKey) {
      zeroBuffer(wrapKey);
    }
  }
}

/**
 * Create a new age identity in memory via `age-keygen` (stdout), with optional temp-file fallback.
 */
export async function generateIdentity(): Promise<Buffer> {
  try {
    return await generateIdentityToBuffer();
  } catch {
    /* try temp-file fallback if stdout output is unsupported */
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-age-"));
  const keyPath = path.join(tmpDir, "key.txt");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("age-keygen", ["-o", keyPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.on("error", () => {
        reject(
          new CerberusError(
            "Encryption tools are not available.",
            ErrorCode.UNKNOWN,
          ),
        );
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new CerberusError(
              "Encryption tools are not available.",
              ErrorCode.UNKNOWN,
            ),
          );
        }
      });
    });
    return await fs.readFile(keyPath);
  } catch (e) {
    if (e instanceof CerberusError) {
      throw e;
    }
    throw new CerberusError(
      "Encryption tools are not available.",
      ErrorCode.UNKNOWN,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
