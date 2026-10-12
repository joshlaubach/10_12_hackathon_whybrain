import type { Schema } from "./contracts";
import { ApiError, interrupted } from "./errors";
import { validateError, validateEvent } from "./validation";

export async function checkResponse(response: Response) {
  if (response.ok) return;
  const body: unknown = await response.json().catch(() => null);
  if (validateError(body)) throw new ApiError(body);
  throw new ApiError({ code: "retrieval_failed", message: `Request failed (${response.status}). Check the API connection and try again.`, retryable: response.status >= 500, request_id: null });
}

/** Parses POST SSE with fragmented UTF-8, CRLF, multiline data, and protocol checks. */
export async function consumeSSE(
  response: Response,
  onEvent: (event: Schema<"StreamEvent">) => void,
  signal: AbortSignal,
  expected: "answer_completed" | "review_completed",
): Promise<Schema<"AnswerCompleted"> | Schema<"ReviewCompleted"> | Schema<"StreamError">> {
  await checkResponse(response);
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw interrupted("The API did not return an event stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let requestId: string | null = null;
  let seq = -1;
  let terminal: Schema<"AnswerCompleted"> | Schema<"ReviewCompleted"> | Schema<"StreamError"> | null = null;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const ensureActive = () => { if (signal.aborted) throw new DOMException("Request cancelled", "AbortError"); };

  function frame(text: string) {
    const data: string[] = [];
    let eventName = "";
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") data.push(value);
      if (field === "event") eventName = value;
    }
    if (!data.length) return;
    let event: unknown;
    try { event = JSON.parse(data.join("\n")); } catch { throw interrupted("The stream contains invalid JSON.", requestId); }
    if (!validateEvent(event)) throw interrupted("The stream event does not match the API contract.", requestId);
    if (eventName && eventName !== event.type) throw interrupted("The event name does not match its payload.", requestId);
    if (terminal) throw interrupted("The server sent data after a terminal event.", requestId);
    if (requestId === null) {
      if (event.type !== "request_started" || event.seq !== 0) throw interrupted("The first event must be request_started with seq 0.");
      requestId = event.request_id;
    } else if (event.request_id !== requestId || event.type === "request_started") {
      throw interrupted("The stream changed request IDs or restarted mid-request.", requestId);
    }
    if (!Number.isInteger(event.seq) || event.seq <= seq) throw interrupted("Stream sequence numbers are out of order.", requestId);
    seq = event.seq;
    if (event.type === "answer_completed" || event.type === "review_completed" || event.type === "error") {
      if (event.type !== expected && event.type !== "error") throw interrupted("The stream returned the wrong terminal event.", requestId);
      terminal = event;
    }
    onEvent(event);
  }

  try {
    ensureActive();
    while (true) {
      const chunk = await reader.read();
      ensureActive();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        frame(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (buffer.length > 2_000_000) throw interrupted("A stream frame exceeded the size limit.", requestId);
      if (chunk.done) break;
    }
    if (buffer.trim()) throw interrupted("The stream closed in the middle of an event.", requestId);
    if (!terminal) throw interrupted("The stream closed without a completed answer, review, or error. Try again.", requestId);
    return terminal;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof ApiError) throw error;
    throw interrupted("The stream connection was interrupted. Try again.", requestId);
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
