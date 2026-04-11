import { describe, expect, it } from "vitest";

import { CerberusError, ErrorCode } from "../../src/core/errors.js";
import {
  errorEnvelope,
  isRetryable,
  sanitizePaths,
} from "../../src/core/json-envelope.js";

describe("isRetryable", () => {
  it("marks IO_FAILED as retryable", () => {
    expect(isRetryable(ErrorCode.IO_FAILED)).toBe(true);
  });

  it("marks SESSION_LOCKED as retryable", () => {
    expect(isRetryable(ErrorCode.SESSION_LOCKED)).toBe(true);
  });

  it("marks SESSION_EXPIRED as retryable", () => {
    expect(isRetryable(ErrorCode.SESSION_EXPIRED)).toBe(true);
  });

  const nonRetryable: ErrorCode[] = [
    ErrorCode.UNKNOWN,
    ErrorCode.INVALID_ARGS,
    ErrorCode.VAULT_NOT_FOUND,
    ErrorCode.VAULT_ALREADY_EXISTS,
    ErrorCode.CONFIG_ERROR,
    ErrorCode.VAULT_STATE_INVALID,
    ErrorCode.BACKUP_FAILED,
    ErrorCode.IMPORT_FAILED,
    ErrorCode.CONFLICT,
  ];

  for (const code of nonRetryable) {
    it(`marks ${code} as non-retryable`, () => {
      expect(isRetryable(code)).toBe(false);
    });
  }
});

describe("sanitizePaths", () => {
  it("replaces Unix absolute paths", () => {
    expect(
      sanitizePaths("Output directory already exists: /Users/alice/backup"),
    ).toBe("Output directory already exists: <path>");
  });

  it("replaces deeply nested paths", () => {
    expect(
      sanitizePaths("File not found: /home/user/.cerberus/vault/entries"),
    ).toBe("File not found: <path>");
  });

  it("replaces Windows absolute paths", () => {
    expect(
      sanitizePaths("File not found: C:\\Users\\alice\\backup"),
    ).toBe("File not found: <path>");
  });

  it("leaves messages without paths intact", () => {
    expect(sanitizePaths("Backup verification failed.")).toBe(
      "Backup verification failed.",
    );
  });

  it("handles mixed content", () => {
    const result = sanitizePaths(
      "Error in /var/data/vault: disk full. Retry /tmp/scratch later.",
    );
    expect(result).toBe("Error in <path>: disk full. Retry <path> later.");
  });
});

describe("errorEnvelope", () => {
  it("wraps a CerberusError with correct fields", () => {
    const error = new CerberusError("Something broke", ErrorCode.BACKUP_FAILED);
    const envelope = errorEnvelope(error);

    expect(envelope).toEqual({
      version: 1,
      status: "error",
      error: {
        code: "BACKUP_FAILED",
        message: "Something broke",
        retryable: false,
      },
    });
  });

  it("marks retryable errors correctly", () => {
    const error = new CerberusError("Disk full", ErrorCode.IO_FAILED);
    const envelope = errorEnvelope(error);

    expect(envelope.error.retryable).toBe(true);
  });

  it("sanitizes paths in error message", () => {
    const error = new CerberusError(
      "Not found: /Users/test/.cerberus/db.sqlite",
      ErrorCode.VAULT_NOT_FOUND,
    );
    const envelope = errorEnvelope(error);

    expect(envelope.error.message).toBe("Not found: <path>");
  });

  it("round-trips through JSON.parse without data loss", () => {
    const error = new CerberusError("Test error", ErrorCode.IMPORT_FAILED);
    const envelope = errorEnvelope(error);
    const serialized = JSON.stringify(envelope);
    const parsed = JSON.parse(serialized);

    expect(parsed).toEqual(envelope);
  });

  it("defaults to UNKNOWN code and non-retryable", () => {
    const error = new CerberusError("Mystery");
    const envelope = errorEnvelope(error);

    expect(envelope.error.code).toBe("UNKNOWN");
    expect(envelope.error.retryable).toBe(false);
  });
});
