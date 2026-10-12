import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { Schema } from "../src/lib/contracts";
import { consumeSSE } from "../src/lib/sse";

const fixture = JSON.parse(readFileSync("../../packages/contracts/fixtures/stream_ask_386_440.json", "utf8")) as Schema<"StreamEvent">[];
function response(events: Schema<"StreamEvent">[], fragment = false) {
  const text = events.map(e => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    if (fragment) for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}

test("fragmented CRLF streams preserve every event and complete once", async () => {
  const received: Schema<"StreamEvent">[] = [];
  await consumeSSE(response(fixture, true), e => received.push(e), new AbortController().signal, "answer_completed");
  assert.deepEqual(received, fixture);
});
test("closing without a terminal event is stream_interrupted", async () => {
  await assert.rejects(consumeSSE(response(fixture.slice(0, -1)), () => {}, new AbortController().signal, "answer_completed"), { code: "stream_interrupted" });
});
test("rejects duplicate or decreasing sequence numbers", async () => {
  const events = fixture.map(e => ({ ...e })); events[2].seq = events[1].seq;
  await assert.rejects(consumeSSE(response(events), () => {}, new AbortController().signal, "answer_completed"), { code: "stream_interrupted" });
});
test("strictly increasing sequence numbers may have gaps", async () => {
  const events = fixture.map((e, i) => ({ ...e, seq: i * 2 }));
  await consumeSSE(response(events), () => {}, new AbortController().signal, "answer_completed");
});
test("rejects mixed request IDs", async () => {
  const events = fixture.map(e => ({ ...e })); events[2].request_id = "other";
  await assert.rejects(consumeSSE(response(events), () => {}, new AbortController().signal, "answer_completed"), { code: "stream_interrupted" });
});
test("rejects a second terminal event or data after terminal", async () => {
  const duplicate = { ...fixture.at(-1)!, seq: 100 };
  await assert.rejects(consumeSSE(response([...fixture, duplicate]), () => {}, new AbortController().signal, "answer_completed"), { code: "stream_interrupted" });
});
test("rejects a review terminal on an ask stream", async () => {
  await assert.rejects(consumeSSE(response(fixture), () => {}, new AbortController().signal, "review_completed"), { code: "stream_interrupted" });
});
test("cancellation interrupts a stalled reader", async () => {
  const abort = new AbortController();
  const stalled = new Response(new ReadableStream(), { headers: { "Content-Type": "text/event-stream" } });
  const result = consumeSSE(stalled, () => {}, abort.signal, "answer_completed");
  abort.abort();
  await assert.rejects(result, { name: "AbortError" });
});
test("malformed payloads are structured errors", async () => {
  const bad = new Response('data: {"type":"answer_completed"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
  await assert.rejects(consumeSSE(bad, () => {}, new AbortController().signal, "answer_completed"), { code: "stream_interrupted" });
});
test("an unterminated SSE frame cannot silently complete", async () => {
  const text = fixture.map(e => `data: ${JSON.stringify(e)}\n\n`).join("").trimEnd();
  await assert.rejects(consumeSSE(new Response(text, { headers: { "Content-Type": "text/event-stream" } }), () => {}, new AbortController().signal, "answer_completed"), { code: "stream_interrupted" });
});
