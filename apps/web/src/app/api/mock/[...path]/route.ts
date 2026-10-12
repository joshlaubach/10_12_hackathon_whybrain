import Ajv2020 from "ajv/dist/2020";
import askSchema from "@contracts/schemas/AskRequest.json";
import reviewSchema from "@contracts/schemas/ProposalReviewRequest.json";
import createSchema from "@contracts/schemas/DraftCreateRequest.json";
import type { Schema } from "@/lib/contracts";
import { readFixture, mockDetail } from "@/lib/fixtures";
import { scenarios, exampleProposal } from "@/lib/scenarios";
import { createMockDraft, getMockDraft } from "@/lib/mock-drafts";
import { ApiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const ajv = new Ajv2020({ strict: false });
const validAsk = ajv.compile<Schema<"AskRequest">>(askSchema);
const validReview = ajv.compile<Schema<"ProposalReviewRequest">>(reviewSchema);
const validCreate = ajv.compile<Schema<"DraftCreateRequest">>(createSchema);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message: string, code: Schema<"ErrorBody">["code"] = "invalid_request", status = 400) => json({ code, message, retryable: false, request_id: null } satisfies Schema<"ErrorBody">, status);

export async function GET(_request: Request, context: Context) {
  const parts = (await context.params).path;
  if (parts.join("/") === "health") return json(await readFixture<Schema<"HealthResponse">>("health"));
  if (parts.join("/") === "decisions") return json(await readFixture<Schema<"DecisionList">>("decisions"));
  if (parts[0] === "decisions" && parts.length === 2) {
    const detail = await mockDetail(parts[1]);
    return detail ? json(detail) : fail("This document is absent from the corpus snapshot.", "not_found", 404);
  }
  if (parts[0] === "drafts" && parts.length === 2) {
    try { return json(getMockDraft(parts[1])); } catch (error) {
      if (error instanceof ApiError) return fail(error.message, error.code, 404);
      throw error;
    }
  }
  return fail("Mock endpoint not found.", "not_found", 404);
}

export async function POST(request: Request, context: Context) {
  const route = (await context.params).path.join("/");
  const raw = await request.text();
  if (raw.length > 1_000_000) return fail("The request is too large.");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail("The request must contain valid JSON."); }
  if (route === "drafts") {
    if (!validCreate(body)) return fail("The draft does not match the API contract.");
    try {
      const result = createMockDraft(body, new URL(request.url).searchParams.get("outcome") === "failed" ? "failed" : "indexed");
      return json(result.record, result.created ? 201 : 200);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.message, error.code, 409);
      throw error;
    }
  }
  let file: string;
  if (route === "ask") {
    if (!validAsk(body)) return fail("The question does not match the API contract.");
    const scenario = scenarios.find(s => s.question === body.question.trim());
    if (!scenario) return fail("Mock playback supports recorded questions only. Choose an example or switch to Connected API.");
    file = scenario.file;
  } else if (route === "proposals/review") {
    if (!validReview(body)) return fail("The proposal does not match the API contract.");
    if (body.proposal_text.trim() !== exampleProposal) return fail("Mock playback reviews the recorded example only. Switch to Connected API to review your own proposal.");
    file = "stream_review_proposal";
  } else return fail("Mock endpoint not found.", "not_found", 404);

  const events = await readFixture<Schema<"StreamEvent">[]>(file);
  const request_id = crypto.randomUUID();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let index = 0;
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      stop = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", stop);
      };
      const tick = () => {
        if (stopped) return;
        if (request.signal.aborted) { stop(); controller.close(); return; }
        const event = { ...events[index++], request_id, fixture: true };
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        if (index === events.length) { stop(); controller.close(); }
        else timer = setTimeout(tick, 300);
      };
      request.signal.addEventListener("abort", stop, { once: true });
      tick();
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
