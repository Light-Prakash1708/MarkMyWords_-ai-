export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "ATTEMPT_REQUIRED"
  | "EVALUATION_REQUIRED"
  | "RUNG_LOCKED"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "SIGNUP_REQUIRED"
  | "SPEND_CAP"
  | "CONFLICT"
  | "UPLOAD_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "BAD_ORIGIN"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  ATTEMPT_REQUIRED: 403,
  EVALUATION_REQUIRED: 403,
  RUNG_LOCKED: 403,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  SIGNUP_REQUIRED: 403,
  SPEND_CAP: 503,
  CONFLICT: 409,
  UPLOAD_REJECTED: 422,
  PROVIDER_UNAVAILABLE: 503,
  BAD_ORIGIN: 403,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryAfterSec?: number;
  constructor(code: ErrorCode, message: string, opts: { details?: unknown; retryAfterSec?: number } = {}) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = opts.details;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
export const invalid = (message: string, details?: unknown) => new AppError("VALIDATION", message, { details });
