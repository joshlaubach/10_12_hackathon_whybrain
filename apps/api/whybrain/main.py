"""Why Brain API. Dev: uv run --project apps/api uvicorn whybrain.main:app --port 8001"""
import asyncio
import json
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import agent, corpus, drafts
from . import schemas as s
from .hydra import load_env

load_env()
app = FastAPI(title="Why Brain API", version="1")
app.add_middleware(
    CORSMiddleware, allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()],
    allow_methods=["*"], allow_headers=["*"])


def error(status: int, code: str, message: str, retryable: bool = False) -> JSONResponse:
    return JSONResponse(s.ErrorBody(code=code, message=message, retryable=retryable).model_dump(), status_code=status)


@app.get("/api/health", response_model=s.HealthResponse)
def health():
    return s.HealthResponse(
        status="ok", snapshot_id=corpus.SNAP, corpus=corpus.counts(),
        configured=s.Configured(hydradb=bool(os.environ.get("HYDRADB_API_KEY")),
                                anthropic=bool(os.environ.get("ANTHROPIC_API_KEY"))))


@app.get("/api/decisions", response_model=s.DecisionList)
def decisions():
    return s.DecisionList(snapshot_id=corpus.SNAP, documents=[corpus.document(d) for d in corpus.BY_ID])


@app.get("/api/decisions/{doc_id}", response_model=s.DecisionDetail)
def decision(doc_id: str):
    if doc_id not in corpus.BY_ID:
        raise HTTPException(404, detail=s.ErrorBody(code="not_found", message=f"{doc_id} is not in the corpus",
                                                    retryable=False).model_dump())
    return corpus.detail(doc_id)


async def sse(request: Request, events):
    """Stream a sync event generator. Stops (and closes the generator) when the client disconnects."""
    done = object()
    try:
        while True:
            ev = await asyncio.to_thread(next, events, done)
            if ev is done:
                return
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            if await request.is_disconnected():
                return
    finally:
        events.close()


@app.post("/api/ask")
async def ask(body: s.AskRequest, request: Request):
    events = agent.ask(body.question, body.mode_preference)
    return StreamingResponse(sse(request, events), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/proposals/review")
async def review_proposal(body: s.ProposalReviewRequest, request: Request):
    if len(body.proposal_text) > agent.MAX_PROPOSAL_CHARS:
        return error(422, "invalid_request", f"proposal_text is limited to {agent.MAX_PROPOSAL_CHARS} characters")
    events = agent.review(body.proposal_text, body.mode_preference)
    return StreamingResponse(sse(request, events), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/drafts", response_model=s.DraftRecord)
def save_draft(body: s.DraftCreateRequest):
    if not drafts.DRAFT_ID_RE.match(body.draft_id):
        return error(422, "invalid_request", "draft_id must be 8-64 characters of letters, digits, '-' or '_'")
    try:
        code, rec = drafts.create(body)
    except ValueError:
        return error(409, "draft_conflict", "draft_id already exists with different content; save as a new draft.")
    return JSONResponse(rec, status_code=code)


@app.get("/api/drafts/{draft_id}", response_model=s.DraftRecord)
def get_draft(draft_id: str):
    rec = drafts.get(draft_id) if drafts.DRAFT_ID_RE.match(draft_id) else None
    if rec is None:
        return error(404, "not_found", f"No draft {draft_id}")
    return rec
