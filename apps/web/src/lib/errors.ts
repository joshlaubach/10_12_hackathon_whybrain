import type { Schema } from "./contracts";

export class ApiError extends Error {
  readonly code: Schema<"ErrorBody">["code"];
  readonly retryable: boolean;
  readonly request_id: string | null;
  constructor(error: Schema<"ErrorBody">) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.request_id = error.request_id;
  }
}

export function interrupted(message: string, request_id: string | null = null) {
  return new ApiError({ code: "stream_interrupted", message, request_id, retryable: true });
}

export function errorBody(error: unknown): Schema<"ErrorBody"> {
  if (error instanceof ApiError) return { code: error.code, message: error.message, retryable: error.retryable, request_id: error.request_id };
  return { code: "retrieval_failed", message: error instanceof Error ? error.message : "The request failed. Try again.", retryable: true, request_id: null };
}
