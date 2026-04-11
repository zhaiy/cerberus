import { CerberusError, ErrorCode } from "./errors.js";

/** JSON error envelope for --json mode failure output */
export interface JsonErrorEnvelope {
  version: 1;
  status: "error";
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

/** Retryable classification for each error code */
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.IO_FAILED,
  ErrorCode.SESSION_LOCKED,
  ErrorCode.SESSION_EXPIRED,
]);

/** Check if an error code represents a retryable failure */
export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

/**
 * Sanitize absolute filesystem paths from a message string.
 * Replaces any path-like segment (/foo/bar/... or C:\foo\bar\...) with `<path>`.
 */
export function sanitizePaths(message: string): string {
  // Unix absolute paths: /anything/with/slashes
  // Windows absolute paths: C:\anything or D:\anything
  return message
    .replace(/(?:\/[\w._-]+){2,}/g, "<path>")
    .replace(/[A-Za-z]:\\[^\s]*/g, "<path>");
}

/** Build a JSON error envelope from a CerberusError */
export function errorEnvelope(error: CerberusError): JsonErrorEnvelope {
  return {
    version: 1,
    status: "error",
    error: {
      code: error.code,
      message: sanitizePaths(error.message),
      retryable: isRetryable(error.code),
    },
  };
}
