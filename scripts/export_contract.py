"""Export the contract: OpenAPI + per-model JSON Schemas under packages/contracts/.

Usage (from repo root): uv run --project apps/api python scripts/export_contract.py [--check]
Then regenerate TS types: (cd packages/contracts && npm run types)
--check exits non-zero if committed files differ from the generated ones.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "api"))

from pydantic import TypeAdapter  # noqa: E402
from pydantic.json_schema import models_json_schema  # noqa: E402

from whybrain import schemas as s  # noqa: E402

OUT = ROOT / "packages" / "contracts"
REF = "#/components/schemas/{model}"
M = lambda name: {"$ref": REF.format(model=name)}  # noqa: E731
JSON = lambda name: {"application/json": {"schema": M(name)}}  # noqa: E731
SSE = {"text/event-stream": {"schema": M("StreamEvent")}}

PATHS = {
    "/api/health": {"get": {"operationId": "getHealth", "responses": {"200": {"description": "Configuration only", "content": JSON("HealthResponse")}}}},
    "/api/decisions": {"get": {"operationId": "listDecisions", "responses": {"200": {"description": "Corpus documents", "content": JSON("DecisionList")}}}},
    "/api/decisions/{doc_id}": {"get": {
        "operationId": "getDecision",
        "parameters": [{"name": "doc_id", "in": "path", "required": True, "schema": {"type": "string"}}],
        "responses": {"200": {"description": "Document with source text", "content": JSON("DecisionDetail")},
                      "404": {"description": "Not found", "content": JSON("ErrorBody")}}}},
    "/api/ask": {"post": {
        "operationId": "ask", "requestBody": {"required": True, "content": JSON("AskRequest")},
        "responses": {"200": {"description": "SSE stream of StreamEvent; exactly one terminal event "
                              "(answer_completed | error), then the server closes", "content": SSE}}}},
    "/api/proposals/review": {"post": {
        "operationId": "reviewProposal", "requestBody": {"required": True, "content": JSON("ProposalReviewRequest")},
        "responses": {"200": {"description": "SSE stream of StreamEvent; exactly one terminal event "
                              "(review_completed | error), then the server closes", "content": SSE}}}},
    "/api/drafts": {"post": {
        "operationId": "saveDraft", "requestBody": {"required": True, "content": JSON("DraftCreateRequest")},
        "responses": {"200": {"description": "Existing record (same draft_id and content_hash)", "content": JSON("DraftRecord")},
                      "201": {"description": "Created", "content": JSON("DraftRecord")},
                      "409": {"description": "draft_conflict: same draft_id, different content", "content": JSON("ErrorBody")}}}},
    "/api/drafts/{draft_id}": {"get": {
        "operationId": "getDraft",
        "parameters": [{"name": "draft_id", "in": "path", "required": True, "schema": {"type": "string"}}],
        "responses": {"200": {"description": "Record; retrieval verification reads from the store", "content": JSON("DraftRecord")},
                      "404": {"description": "Not found", "content": JSON("ErrorBody")}}}},
}


def build():
    _, defs = models_json_schema([(m, "validation") for m in s.MODELS], ref_template=REF)
    schemas = dict(defs.get("$defs", {}))
    stream = TypeAdapter(s.StreamEvent).json_schema(ref_template=REF)
    schemas.update(stream.pop("$defs", {}))
    schemas["StreamEvent"] = stream
    openapi = {"openapi": "3.1.0", "info": {"title": "Why Brain API", "version": "1.0.0"},
               "paths": PATHS, "components": {"schemas": dict(sorted(schemas.items()))}}
    files = {OUT / "openapi.json": openapi}
    for m in s.MODELS:
        files[OUT / "schemas" / f"{m.__name__}.json"] = m.model_json_schema()
    files[OUT / "schemas" / "StreamEvent.json"] = TypeAdapter(s.StreamEvent).json_schema()
    return {p: json.dumps(v, indent=2, sort_keys=True) + "\n" for p, v in files.items()}


def main():
    out = build()
    if "--check" in sys.argv:
        stale = [str(p.relative_to(ROOT)) for p, t in out.items() if not p.exists() or p.read_text() != t]
        if stale:
            print("contract out of date:", *stale, sep="\n  ")
            sys.exit(1)
        print("contract up to date")
        return
    for p, t in out.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(t)
    print(f"wrote {len(out)} files under {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
