"""API responses validate against schemas.py. HydraDB and the model are faked; no network."""
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

from whybrain import agent, corpus, main
from whybrain import schemas as s
from whybrain.quotes import quote_in_source

EVENTS = TypeAdapter(s.StreamEvent)
client = TestClient(main.app)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("HYDRADB_API_KEY", "x")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")


def passages(*docs):
    return {"passages": [{"doc_id": d, "locator": "Header", "text": corpus.sections(d)[0].text} for d in docs],
            "triplets": []}


def fake_model(**out):
    base = {"supported": True, "answer": "PEP 386 is Superseded; PEP 440 replaces it.",
            "citations": [{"doc_id": "pep-0386", "quote": "Superseded-By: 440"}], "abstain_reason": None}
    return lambda q, facts, p: {**base, **out}


def run(question="Why was PEP 386 replaced?", **kw):
    r = client.post("/api/ask", json={"question": question, **kw})
    assert r.status_code == 200
    evs = [EVENTS.validate_python(json.loads(c[6:])) for c in r.text.split("\n\n") if c.startswith("data: ")]
    assert [e.seq for e in evs] == list(range(len(evs)))
    assert len({e.request_id for e in evs}) == 1
    terminals = [e for e in evs if e.type in s.TERMINAL_TYPES]
    assert len(terminals) == 1 and evs[-1] is terminals[0]
    return evs


def test_rest_endpoints_validate():
    s.HealthResponse(**client.get("/api/health").json())
    lst = s.DecisionList(**client.get("/api/decisions").json())
    assert len(lst.documents) == len(corpus.BY_ID)
    d = s.DecisionDetail(**client.get("/api/decisions/pep-0386").json())
    assert d.source_status == "Superseded" and any(x.locator == "Abstract" for x in d.sections)
    assert client.get("/api/decisions/pep-9999").status_code == 404


def test_live_answer(monkeypatch):
    monkeypatch.setattr(agent, "hydra_search", lambda q: passages("pep-0386", "pep-0440"))
    monkeypatch.setattr(agent, "call_model", fake_model())
    evs = run()
    a = evs[-1]
    assert a.type == "answer_completed" and not a.abstained
    assert a.provenance.mode_used == "LIVE" and "pep-0386" in a.provenance.hydradb_evidence_doc_ids
    assert {(e.source_doc_id, e.relation, e.target_doc_id) for e in a.evidence_edges} >= {
        ("pep-0386", "superseded_by", "pep-0440"), ("pep-0440", "replaces", "pep-0386")}
    assert all(e.origin == "source_header" for e in a.evidence_edges)
    assert "pep-0440" in a.inspected_doc_ids
    for c in a.citations:
        assert quote_in_source(c.quote, corpus.text(c.doc_id))
    assert len([e for e in evs if e.type == "tool_started"]) <= agent.MAX_TOOL_CALLS


def test_hydradb_failure_is_local_not_live(monkeypatch):
    def boom(q):
        raise RuntimeError("down")
    monkeypatch.setattr(agent, "hydra_search", boom)
    monkeypatch.setattr(agent, "call_model", fake_model())
    a = run()[-1]
    assert a.provenance.mode_used == "LOCAL" and a.provenance.hydradb_failures == 1
    assert a.provenance.hydradb_evidence_doc_ids == []


def test_model_failure_is_an_error_never_a_fallback(monkeypatch):
    monkeypatch.setattr(agent, "hydra_search", lambda q: passages("pep-0386"))
    def boom(*a):
        raise RuntimeError("down")
    monkeypatch.setattr(agent, "call_model", boom)
    e = run()[-1]
    assert e.type == "error" and e.code == "model_unavailable"


def test_unverifiable_quote_is_rejected_and_answer_abstains(monkeypatch):
    monkeypatch.setattr(agent, "hydra_search", lambda q: passages("pep-0386"))
    monkeypatch.setattr(agent, "call_model", fake_model(citations=[{"doc_id": "pep-0386", "quote": "invented words"}]))
    a = run()[-1]
    assert a.abstained and a.answer is None and a.citations == []


def test_citation_outside_inspected_set_is_rejected(monkeypatch):
    monkeypatch.setattr(agent, "hydra_search", lambda q: passages("pep-0386"))
    monkeypatch.setattr(agent, "call_model", fake_model(
        citations=[{"doc_id": "pep-0621", "quote": corpus.sections("pep-0621")[0].text.split("\n")[0]}]))
    assert run()[-1].abstained


def test_missing_successor_is_a_gap(monkeypatch):
    monkeypatch.setattr(agent, "hydra_search", lambda q: passages("pep-0563"))
    monkeypatch.setattr(agent, "call_model", fake_model(
        citations=[{"doc_id": "pep-0563", "quote": "Superseded-By: 649, 749"}]))
    a = run("What replaced PEP 563?")[-1]
    gaps = [e for e in a.evidence_edges if not e.target_in_corpus]
    assert [e.target_doc_id for e in gaps] == ["pep-0749"] and "pep-0749" not in a.inspected_doc_ids


def test_tool_summary_reports_graph_context(monkeypatch):
    r = passages("pep-0386")
    r["triplets"] = [{"source": {"identifier": "440"}, "target": {"identifier": "386"},
                      "relation": {"canonical_predicate": "replaces"}}]
    monkeypatch.setattr(agent, "hydra_search", lambda q: r)
    monkeypatch.setattr(agent, "call_model", fake_model())
    evs = run()
    summ = next(e.summary for e in evs if e.type == "tool_completed")
    assert "1 triplets, 1 match header edges" in summ


def test_replay_is_labelled_and_makes_no_calls(monkeypatch):
    monkeypatch.setattr(agent, "hydra_search", lambda q: pytest.fail("no HydraDB in REPLAY"))
    evs = run(mode_preference="REPLAY")
    assert evs[0].mode == "REPLAY" and evs[-1].provenance.mode_used == "REPLAY"


PROPOSAL = ("Sort development releases such as 1.0.dev1 between the last release candidate and the final "
            "release, so that dev builds sort after rc builds.")
QUOTE = ("This is a far more logical sort order, as projects already using both development releases and "
         "alphas/betas/release candidates do not want their developmental releases sorted in between their "
         "release candidates and their final releases.")


def review(**kw):
    r = client.post("/api/proposals/review", json={"proposal_text": PROPOSAL, **kw})
    assert r.status_code == 200
    evs = [EVENTS.validate_python(json.loads(c[6:])) for c in r.text.split("\n\n") if c.startswith("data: ")]
    assert [e.seq for e in evs] == list(range(len(evs)))
    assert sum(e.type in s.TERMINAL_TYPES for e in evs) == 1 and evs[-1].type in s.TERMINAL_TYPES
    return evs


def fake_review(findings):
    return lambda proposal, facts, p: {"findings": findings}


def test_review_findings_edges_and_authority(monkeypatch):
    monkeypatch.setattr(agent, "hydra_search", lambda q: passages("pep-0440"))
    monkeypatch.setattr(agent, "call_review_model", fake_review([
        {"claim": "dev after rc", "doc_id": "pep-0440", "quote": QUOTE, "relation": "may_contradict",
         "explanation": "PEP 440 sorts dev releases first.", "uncertainty": "low"},
        {"claim": "dev after rc", "doc_id": "pep-0440", "quote": QUOTE, "relation": "suggests_replacing",
         "explanation": "Would replace PEP 440's sort order.", "uncertainty": "low"},
        {"claim": "x", "doc_id": "pep-0440", "quote": "made up quote", "relation": "may_repeat",
         "explanation": "x", "uncertainty": "low"}]))
    r = review()[-1]
    assert r.type == "review_completed" and len(r.findings) == 2  # fabricated quote rejected
    rels = {(e.relation, e.origin) for e in r.evidence_edges}
    assert ("potential_conflict", "inferred") in rels and ("proposes_to_replace", "proposal") in rels
    assert not any(e.origin == "proposal" and e.relation in ("replaces", "superseded_by") for e in r.evidence_edges)
    assert r.provenance.mode_used == "LIVE" and r.recorded_contacts
    assert "PROPOSAL" in r.draft_md and "not accepted" in r.draft_md


def test_review_model_failure_is_an_error(monkeypatch):
    monkeypatch.setattr(agent, "hydra_search", lambda q: passages("pep-0440"))
    def boom(*a):
        raise RuntimeError("down")
    monkeypatch.setattr(agent, "call_review_model", boom)
    e = review()[-1]
    assert e.type == "error" and e.code == "model_unavailable"


def test_review_is_bounded():
    r = client.post("/api/proposals/review", json={"proposal_text": "x" * 2001})
    assert r.status_code == 422 and r.json()["code"] == "invalid_request"


def test_replacing_a_superseded_decision_is_downgraded(monkeypatch):
    monkeypatch.setattr(agent, "hydra_search", lambda q: passages("pep-0386"))
    monkeypatch.setattr(agent, "call_review_model", fake_review([
        {"claim": "c", "doc_id": "pep-0386", "quote": "Superseded-By: 440", "relation": "suggests_replacing",
         "explanation": "e", "uncertainty": "low"}]))
    r = review()[-1]
    assert [f.relation for f in r.findings] == ["may_repeat"]
    assert not any(e.relation == "proposes_to_replace" for e in r.evidence_edges)
