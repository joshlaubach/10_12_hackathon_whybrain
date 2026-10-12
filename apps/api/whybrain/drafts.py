"""Saved proposals. A draft never touches accepted documents, edges or statuses.

Two stages are tracked separately and `status` is "indexed" only when both pass:
  provider_indexing      provider (HydraDB) reports the draft searchable: status `completed`, or
                         `graph_creation` AND a query already returns the draft
  retrieval_verification a query against the DRAFTS collection returned this draft_id from the real
                         store (HydraDB, or the explicit local store when no HydraDB key is configured);
                         the cached save response never counts.
Drafts live in their own collection (wb_dev_drafts / wb_demo_drafts), never the accepted one.
"""
import json
import os
import re
import threading
import time
from pathlib import Path

from . import corpus
from . import schemas as s
from .hydra import Hydra, HydraError, load_env

DRAFT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
INDEX_TIMEOUT_S = 600
# Provider states at or past the point where content is searchable (graph enrichment may still run).
# They only count once a query returns this draft_id; the state name alone never makes a draft indexed.
SEARCHABLE_STATES = ("completed", "graph_creation")
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def drafts_collection() -> str:
    return os.environ.get("HYDRA_DRAFTS_COLLECTION", corpus.CFG["drafts_collection"])


def store_dir() -> Path:
    d = Path(os.environ.get("DRAFTS_DIR", corpus.ROOT / ".drafts"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _lock(draft_id: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(draft_id, threading.Lock())


def _path(draft_id: str) -> Path:
    return store_dir() / f"{draft_id}.json"


def _load(draft_id: str) -> dict | None:
    p = _path(draft_id)
    return json.loads(p.read_text()) if p.exists() else None


def _save(state: dict) -> None:
    _path(state["record"]["draft_id"]).write_text(json.dumps(state, ensure_ascii=False, indent=1))


def provider_text(rec: dict) -> str:
    """What is indexed: clearly labelled so retrieval can never mistake a proposal for a decision."""
    return (f"[PROPOSAL, not an accepted decision]\nDraft id: {rec['draft_id']}\nTitle: {rec['title']}\n"
            f"Proposes to replace (suggestion only): {', '.join(rec['proposes_to_replace']) or 'none'}\n\n"
            f"{rec['body_md']}\n")


def _set(state: dict, **kw) -> dict:
    rec = {**state["record"], **kw}
    st = rec
    if st["provider_indexing"] == "failed" or st["retrieval_verification"] == "failed":
        rec["status"] = "failed"
        rec["error"] = rec.get("error") or "Indexing or retrieval verification failed."
    elif st["provider_indexing"] == "completed" and st["retrieval_verification"] == "verified":
        rec["status"] = "indexed"
    else:
        rec["status"] = "pending"
    state["record"] = s.DraftRecord(**rec).model_dump()  # validates the stage rules
    _save(state)
    return state


def _hydra_verify(rec: dict) -> bool:
    data = Hydra().query([drafts_collection()], f"{rec['title']} {rec['draft_id']}", max_results=8, graph=False)
    for ch in data.get("chunks") or []:
        if (ch.get("source_title") or "").startswith(rec["draft_id"]) or rec["draft_id"] in (ch.get("chunk_content") or ""):
            return True
    return False


def _local_verify(rec: dict) -> bool:
    p = store_dir() / f"{rec['draft_id']}.txt"  # read back from the local store, not the save-time cache
    return p.exists() and rec["draft_id"] in p.read_text() and rec["content_hash"] == s.draft_content_hash(
        rec["title"], rec["body_md"], rec["proposes_to_replace"])


def advance(draft_id: str) -> dict | None:
    """Move a pending draft one step forward. Idempotent; safe to call from GET and the worker."""
    with _lock(draft_id):
        state = _load(draft_id)
        if not state or state["record"]["status"] != "pending":
            return state
        rec = state["record"]
        try:
            if time.time() - state["created"] > INDEX_TIMEOUT_S:
                return _set(state, provider_indexing="failed" if rec["provider_indexing"] != "completed" else "completed",
                            retrieval_verification="failed" if rec["provider_indexing"] == "completed" else "pending",
                            error="Timed out before the draft could be indexed and read back.")
            if state["backend"] == "hydradb":
                if rec["provider_indexing"] == "pending":
                    st = Hydra().status(drafts_collection(), rec["draft_id"])
                    if st == "errored":
                        return _set(state, provider_indexing="failed", error="HydraDB reported an indexing error.")
                    if st == "completed":
                        state = _set(state, provider_indexing="completed")
                    elif st in SEARCHABLE_STATES and _hydra_verify(rec):
                        # graph enrichment may still be running, but the store already returns this draft
                        return _set(state, provider_indexing="completed", retrieval_verification="verified",
                                    verified_via="hydradb")
                rec = state["record"]
                if rec["provider_indexing"] == "completed" and rec["retrieval_verification"] == "pending":
                    if _hydra_verify(rec):
                        state = _set(state, retrieval_verification="verified", verified_via="hydradb")
            else:
                (store_dir() / f"{rec['draft_id']}.txt").write_text(provider_text(rec))
                state = _set(state, provider_indexing="completed")
                if _local_verify(state["record"]):
                    state = _set(state, retrieval_verification="verified", verified_via="local_store")
                else:
                    state = _set(state, retrieval_verification="failed", error="Local store read-back failed.")
        except HydraError as e:
            # transient provider errors keep the draft pending until the timeout; nothing is claimed
            state["last_error"] = str(e)[:200]
            _save(state)
        return state


def _worker(draft_id: str) -> None:
    deadline = time.time() + INDEX_TIMEOUT_S + 30
    while time.time() < deadline:
        st = advance(draft_id)
        if not st or st["record"]["status"] != "pending":
            return
        time.sleep(4)


def create(req: s.DraftCreateRequest) -> tuple[int, dict]:
    """-> (http_status, DraftRecord dict). 201 created, 200 existing, 409 handled by the caller via ValueError."""
    load_env()
    h = s.draft_content_hash(req.title, req.body_md, req.proposes_to_replace)
    with _lock(req.draft_id):
        existing = _load(req.draft_id)
        if existing:
            if existing["record"]["content_hash"] != h:
                raise ValueError("draft_conflict")
            return 200, existing["record"]
        backend = "hydradb" if os.environ.get("HYDRADB_API_KEY") else "local"
        rec = s.DraftRecord(
            draft_id=req.draft_id, content_hash=h, title=req.title, body_md=req.body_md,
            proposes_to_replace=req.proposes_to_replace, status="pending", provider_indexing="pending",
            retrieval_verification="pending").model_dump()
        state = {"record": rec, "backend": backend, "created": time.time(), "collection": drafts_collection()}
        if backend == "hydradb":
            try:
                Hydra().ingest_text(drafts_collection(), req.draft_id, provider_text(rec),
                                    {"label": "PROPOSAL", "content_hash": h})
            except HydraError as e:
                state = _set(state, provider_indexing="failed", error=f"HydraDB did not accept the draft: {e}"[:300])
                return 201, state["record"]
        _save(state)
    threading.Thread(target=_worker, args=(req.draft_id,), daemon=True).start()
    return 201, rec


def get(draft_id: str) -> dict | None:
    st = advance(draft_id)
    return st["record"] if st else None
