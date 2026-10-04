export type ErrorCode =
  | "EMPTY_ALPHABET"
  | "DUPLICATE_SYMBOL"
  | "INVALID_SYMBOL"
  | "INVALID_N"
  | "LIMIT_EXCEEDED"
  | "INVALID_CYCLE_LENGTH"
  | "UNKNOWN_SYMBOL"
  | "WORD_LENGTH_MISMATCH"
  | "NOT_FOUND"
  | "BAD_REQUEST";

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}
