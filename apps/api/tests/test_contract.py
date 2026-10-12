import json
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from whybrain import schemas as s
from whybrain.quotes import quote_in_source

ROOT = Path(__file__).resolve().parents[3]
FIX = ROOT / "packages" / "contracts" / "fixtures"
PEPS = ROOT / "data" / "peps"
MAN = json.loads((PEPS / "manifest.json").read_text())
BY_ID = {d["doc_id"]: d for d in MAN["docs"]}
STREAMS = sorted(FIX.glob("stream_*.json"))
EVENTS = TypeAdapter(s.StreamEvent)


def load(name):
    return json.loads((FIX / name).read_text())


def test_fixtures_exist():
    assert len(STREAMS) >= 5 and (FIX / "draft_indexed.json").exists()


@pytest.mark.parametrize("path", STREAMS, ids=lambda p: p.name)
def test_stream_shape(path):
    evs = [EVENTS.validate_python(e) for e in json.loads(path.read_text())]
    assert [e.seq for e in evs] == list(range(len(evs))), "seq strictly increasing from 0"
    assert len({e.request_id for e in evs}) == 1
    assert evs[0].type == "request_started"
    terminals = [e for e in evs if e.type in s.TERMINAL_TYPES]
    assert len(terminals) == 1 and evs[-1] is terminals[0], "exactly one terminal event, last"
    assert all(e.fixture for e in evs)
    started = {e.call_id for e in evs if e.type == "tool_started"}
    assert started == {e.call_id for e in evs if e.type == "tool_completed"}


def _quotes(ev):
    for c in getattr(ev, "citations", []):
        yield c.doc_id, c.quote
    for f in getattr(ev, "findings", []):
        yield f.doc_id, f.quote
    for e in getattr(ev, "evidence_edges", []):
        for r in e.supporting_evidence:
            yield r.doc_id, r.quote


@pytest.mark.parametrize("path", STREAMS, ids=lambda p: p.name)
def test_quotes_are_in_sources(path):
    for e in json.loads(path.read_text()):
        for doc_id, quote in _quotes(EVENTS.validate_python(e)):
            src = (PEPS / BY_ID[doc_id]["file"]).read_text()
            assert quote_in_source(quote, src), f"{doc_id}: {quote!r}"


@pytest.mark.parametrize("path", STREAMS, ids=lambda p: p.name)
def test_header_edges_match_source_headers(path):
    for e in json.loads(path.read_text()):
        ev = EVENTS.validate_python(e)
        for edge in getattr(ev, "evidence_edges", []):
            if edge.origin != "source_header":
                continue
            d = BY_ID[edge.source_doc_id]
            field = "superseded_by" if edge.relation == "superseded_by" else "replaces"
            assert edge.target_doc_id in d[field], edge
            assert edge.target_in_corpus == (edge.target_doc_id in BY_ID)


def test_missing_successor_is_an_explicit_gap():
    ev = EVENTS.validate_python(load("stream_ask_missing_successor_563.json")[-1])
    gap = [e for e in ev.evidence_edges if not e.target_in_corpus]
    assert [e.target_doc_id for e in gap] == ["pep-0749"]
    assert "pep-0749" not in ev.inspected_doc_ids


def test_unsupported_question_abstains_without_citations():
    ev = EVENTS.validate_python(load("stream_ask_unsupported.json")[-1])
    assert ev.abstained and ev.answer is None and ev.citations == []


def test_review_never_creates_authoritative_replacement():
    ev = EVENTS.validate_python(load("stream_review_proposal.json")[-1])
    rels = {(e.relation, e.origin) for e in ev.evidence_edges}
    assert ("proposes_to_replace", "proposal") in rels
    assert not any(r in ("replaces", "superseded_by") for r, _ in rels)
    assert {f.relation for f in ev.findings} <= {"may_contradict", "may_repeat", "suggests_replacing"}


def _prov(**kw):
    base = dict(mode_used="LIVE", hydradb_requests=1, hydradb_failures=0, hydradb_evidence_doc_ids=["pep-0440"],
                model_requests=1, model_failures=0, model_completed=True)
    return s.Provenance(**{**base, **kw})


def test_live_requires_evidence_and_completed_model():
    _prov()
    with pytest.raises(ValidationError):
        _prov(model_completed=False, model_failures=1)
    with pytest.raises(ValidationError):
        _prov(hydradb_evidence_doc_ids=[], hydradb_failures=1)
    with pytest.raises(ValidationError):
        _prov(mode_used="REPLAY")


def test_live_answer_must_cite_a_hydradb_supplied_doc():
    d = load("stream_ask_386_440.json")[-1]
    d["provenance"]["hydradb_evidence_doc_ids"] = ["pep-0621"]
    with pytest.raises(ValidationError):
        EVENTS.validate_python(d)


def test_proposal_cannot_be_an_authoritative_edge():
    with pytest.raises(ValidationError):
        s.EvidenceEdge(edge_id="x", source_doc_id="proposal", target_doc_id="pep-0440", relation="replaces",
                       origin="proposal", target_in_corpus=True, supporting_evidence=[])


def test_draft_indexed_needs_verified_retrieval():
    base = load("draft_pending.json")
    with pytest.raises(ValidationError):
        s.DraftRecord(**{**base, "status": "indexed"})
    with pytest.raises(ValidationError):
        s.DraftRecord(**{**base, "status": "indexed", "provider_indexing": "completed",
                         "retrieval_verification": "pending"})
    for name in ("draft_pending", "draft_indexed", "draft_indexed_local", "draft_failed"):
        s.DraftRecord(**load(f"{name}.json"))
    assert load("draft_indexed.json")["verified_via"] == "hydradb"


def test_draft_hash_matches_request_and_is_stable():
    req = s.DraftCreateRequest(**load("draft_create_request.json"))
    h = s.draft_content_hash(req.title, req.body_md, req.proposes_to_replace)
    assert h == load("draft_pending.json")["content_hash"]
    assert h == s.draft_content_hash(req.title + " ", req.body_md, list(reversed(req.proposes_to_replace)))
    assert h != s.draft_content_hash(req.title, req.body_md + "x", req.proposes_to_replace)


def test_draft_conflict_fixture_is_an_error_body():
    e = s.ErrorBody(**load("draft_conflict.json"))
    assert e.code == "draft_conflict" and not e.retryable


def test_decision_fixtures():
    lst = s.DecisionList(**load("decisions.json"))
    assert lst.snapshot_id == MAN["snapshot_id"] and len(lst.documents) == len(MAN["docs"])
    d = s.DecisionDetail(**load("decision_pep-0386.json"))
    assert d.source_status == "Superseded" and d.superseded_by[0].doc_id == "pep-0440"
    assert any(x.locator == "Abstract" for x in d.sections)
    sections = {x.heading: x.text for x in d.sections}
    assert "Superseded-By: 440" in sections["Header"]
    s.HealthResponse(**load("health.json"))


def test_manifest_is_consistent():
    ids = set(BY_ID)
    for d in MAN["docs"]:
        assert (PEPS / d["file"]).exists()
    gaps = {(g["doc_id"], g["missing_successor"]) for g in MAN["missing_successors"]}
    for d in MAN["docs"]:
        for t in d["superseded_by"]:
            assert (t in ids) or ((d["doc_id"], t) in gaps)
    assert "pep-0749" in {t for _, t in gaps}


def test_committed_contract_is_current():
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "export_contract.py"), "--check"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
