export enum ErrorCode {
  UNKNOWN = "UNKNOWN",
  INVALID_ARGS = "INVALID_ARGS",
  VAULT_NOT_FOUND = "VAULT_NOT_FOUND",
  VAULT_ALREADY_EXISTS = "VAULT_ALREADY_EXISTS",
  CONFIG_ERROR = "CONFIG_ERROR",
  /** ~/.cerberus exists but is missing required files or is inconsistent */
  VAULT_STATE_INVALID = "VAULT_STATE_INVALID",
  SESSION_LOCKED = "SESSION_LOCKED",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  BACKUP_FAILED = "BACKUP_FAILED",
}

const errorCodeToExitCode: Record<ErrorCode, number> = {
  [ErrorCode.UNKNOWN]: 1,
  [ErrorCode.INVALID_ARGS]: 2,
  [ErrorCode.VAULT_NOT_FOUND]: 3,
  [ErrorCode.VAULT_ALREADY_EXISTS]: 4,
  [ErrorCode.CONFIG_ERROR]: 5,
  [ErrorCode.VAULT_STATE_INVALID]: 6,
  [ErrorCode.SESSION_LOCKED]: 7,
  [ErrorCode.SESSION_EXPIRED]: 8,
  [ErrorCode.BACKUP_FAILED]: 9,
};

export class CerberusError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;

  constructor(message: string, code: ErrorCode = ErrorCode.UNKNOWN) {
    super(message);
    this.name = "CerberusError";
    this.code = code;
    this.exitCode = errorCodeToExitCode[code];
  }
}

export class CliError extends CerberusError {
  constructor(message: string) {
    super(message, ErrorCode.INVALID_ARGS);
    this.name = "CliError";
  }
}

