import type { ValidateFunction } from "ajv";
import type { Schema, Transport } from "./contracts";
import { ApiError } from "./errors";
import { checkResponse } from "./sse";
import { validateDetail, validateDraft, validateHealth, validateList } from "./validation";

export const apiBase = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
export function endpoint(transport: Transport, path: string) {
  return transport === "mock" ? `/api/mock/${path}` : `${apiBase}/api/${path}`;
}

async function json<T>(url: string, validate: ValidateFunction<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(15000) });
  await checkResponse(response);
  const body: unknown = await response.json();
  if (!validate(body)) throw new ApiError({ code: "internal_error", message: "The API response does not match the generated contract.", request_id: null, retryable: false });
  return body;
}

export async function loadCorpus(transport: Transport, signal: AbortSignal) {
  const [list, health] = await Promise.all([
    json(endpoint(transport, "decisions"), validateList, { signal }),
    json(endpoint(transport, "health"), validateHealth, { signal }),
  ]);
  return { list, health };
}

const details = new Map<string, Promise<Schema<"DecisionDetail">>>();
export function loadDetail(transport: Transport, snapshot: string, id: string) {
  const key = `${transport}:${snapshot}:${id}`;
  const existing = details.get(key);
  if (existing) return existing;
  const pending = json(endpoint(transport, `decisions/${encodeURIComponent(id)}`), validateDetail);
  details.set(key, pending);
  void pending.catch(() => details.delete(key));
  return pending;
}

export function saveDraft(transport: Transport, request: Schema<"DraftCreateRequest">, signal: AbortSignal, outcome: "indexed" | "failed") {
  const suffix = transport === "mock" ? `?outcome=${outcome}` : "";
  return json(endpoint(transport, `drafts${suffix}`), validateDraft, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal });
}

export function readDraft(transport: Transport, id: string, signal: AbortSignal) {
  return json(endpoint(transport, `drafts/${encodeURIComponent(id)}`), validateDraft, { signal });
}
