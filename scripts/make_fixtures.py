"""Generate packages/contracts/fixtures/*.json from the committed corpus and the contract models.

Usage (from repo root): uv run --project apps/api python scripts/make_fixtures.py
Every fixture is validated against apps/api/whybrain/schemas.py before it is written and is
marked fixture=true (the UI shows 'Mock data'). Quotes are checked by tests/test_contract.py.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "api"))

from pydantic import TypeAdapter  # noqa: E402

from whybrain import schemas as s  # noqa: E402

PEPS = ROOT / "data" / "peps"
OUT = ROOT / "packages" / "contracts" / "fixtures"
MAN = json.loads((PEPS / "manifest.json").read_text())
SNAP = MAN["snapshot_id"]
BY_ID = {d["doc_id"]: d for d in MAN["docs"]}
URL = "https://peps.python.org/pep-{n:04d}/"


def ref(doc_id):
    n = int(doc_id.split("-")[1])
    return s.DocRef(doc_id=doc_id, source_url=URL.format(n=n), in_corpus=doc_id in BY_ID)


def document(d):
    return dict(
        doc_id=d["doc_id"], source_url=d["source_url"], title=d["title"], source_status=d["source_status"],
        authors=d["authors"], discussions_to=d["discussions_to"], resolution_url=d["resolution_url"],
        replaces=[ref(x) for x in d["replaces"]], superseded_by=[ref(x) for x in d["superseded_by"]],
        missing_successors=[x for x in d["superseded_by"] if x not in BY_ID], snapshot_id=SNAP)


def sections(text):
    lines, out, i = text.split("\n"), [], 0
    head_end = lines.index("") if "" in lines else len(lines)
    out.append(s.Section(locator="Header", heading="Header", text="\n".join(lines[:head_end])))
    cur, buf = None, []
    while i < len(lines):
        if i + 1 < len(lines) and lines[i].strip() and re.fullmatch(r"([=\-~^]){3,}", lines[i + 1].strip()) \
                and i >= head_end:
            if cur:
                out.append(s.Section(locator=cur, heading=cur, text="\n".join(buf).strip()))
            cur, buf, i = lines[i].strip(), [], i + 2
            continue
        if cur:
            buf.append(lines[i])
        i += 1
    if cur:
        out.append(s.Section(locator=cur, heading=cur, text="\n".join(buf).strip()))
    return out


def edge(eid, src, dst, rel, origin, in_corpus, ev, expl=None, unc=None):
    return s.EvidenceEdge(edge_id=eid, source_doc_id=src, target_doc_id=dst, relation=rel, origin=origin,
                          target_in_corpus=in_corpus, supporting_evidence=[s.EvidenceRef(**e) for e in ev],
                          explanation=expl, uncertainty=unc)


def cite(doc_id, quote, loc):
    return s.Citation(doc_id=doc_id, source_url=BY_ID[doc_id]["source_url"], quote=quote, locator=loc)


def events(rid, mode, steps, terminal):
    out = [dict(type="request_started", request_id=rid, seq=0, fixture=True, mode=mode, snapshot_id=SNAP)]
    for tool, args, summary, ids in steps:
        n = len(out)
        cid = f"call-{(n + 1) // 2}"
        out.append(dict(type="tool_started", request_id=rid, seq=n, fixture=True, call_id=cid, tool=tool, args=args))
        out.append(dict(type="tool_completed", request_id=rid, seq=n + 1, fixture=True, call_id=cid, tool=tool,
                        ok=True, summary=summary, doc_ids=ids))
    terminal.update(request_id=rid, seq=len(out), fixture=True)
    out.append(terminal)
    return out


def dump(name, obj):
    if isinstance(obj, list) and obj and isinstance(obj[0], dict) and "type" in obj[0]:
        data = [json.loads(TypeAdapter(s.StreamEvent).validate_python(e).model_dump_json()) for e in obj]
    else:
        data = json.loads(obj.model_dump_json())
    (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def prov(mode, hdb_ids, hdb_req, model_req=1, done=True):
    return s.Provenance(mode_used=mode, hydradb_requests=hdb_req, hydradb_failures=0,
                        hydradb_evidence_doc_ids=hdb_ids, model_requests=model_req, model_failures=0,
                        model_completed=done)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    docs = [s.Document(**document(d)) for d in MAN["docs"]]
    dump("decisions.json", s.DecisionList(snapshot_id=SNAP, documents=docs))
    dump("health.json", s.HealthResponse(
        status="ok", configured=s.Configured(hydradb=True, anthropic=True), snapshot_id=SNAP,
        corpus=s.CorpusCounts(documents=len(docs),
                              source_header_edges=sum(len(d["replaces"]) + len(d["superseded_by"]) for d in MAN["docs"]),
                              missing_successors=len(MAN["missing_successors"]))))
    t386 = (PEPS / "pep-0386.rst").read_text()
    dump("decision_pep-0386.json", s.DecisionDetail(**document(BY_ID["pep-0386"]), body_text=t386, sections=sections(t386)))

    # --- ask: 386 -> 440 ---
    q_ab = "Note: This PEP has been superseded by the version identification and dependency specification scheme defined in :pep:`440`."
    c440_abs = "This document addresses several limitations of the previous attempt at a standardized approach to versioning, as described in :pep:`345` and :pep:`386`."
    c440_must = "this PEP MUST be used for all versions of metadata and supersedes :pep:`386` even for metadata v1.2."
    c440_why = "This is a far more logical sort order, as projects already using both development releases and alphas/betas/release candidates do not want their developmental releases sorted in between their release candidates and their final releases."
    terminal = dict(
        type="answer_completed", abstained=False, abstain_reason=None, as_of=SNAP,
        answer=("PEP 386 was superseded by PEP 440. PEP 440 says it addresses several limitations of the earlier "
                "versioning approach in PEP 345 and PEP 386, and that it supersedes PEP 386 even for metadata v1.2. "
                "One stated reason: it sorts top-level .devN releases ahead of alpha releases, because projects do not "
                "want developmental releases sorted between their release candidates and final releases. "
                "As of this corpus snapshot PEP 386 is Superseded and PEP 440 is Final."),
        citations=[
            cite("pep-0386", "Superseded-By: 440", "Header"),
            cite("pep-0386", q_ab, "Abstract"),
            cite("pep-0440", "Replaces: 386", "Header"),
            cite("pep-0440", c440_abs, "Abstract"),
            cite("pep-0440", c440_must, "Version ordering across different metadata versions"),
            cite("pep-0440", c440_why, "Changing the version scheme"),
        ],
        inspected_doc_ids=["pep-0386", "pep-0440"],
        evidence_edges=[
            edge("e1", "pep-0386", "pep-0440", "superseded_by", "source_header", True,
                 [dict(doc_id="pep-0386", quote="Superseded-By: 440", locator="Header")]),
            edge("e2", "pep-0440", "pep-0386", "replaces", "source_header", True,
                 [dict(doc_id="pep-0440", quote="Replaces: 386", locator="Header")]),
        ],
        provenance=prov("LIVE", ["pep-0386", "pep-0440"], 2))
    dump("stream_ask_386_440.json", events("req-ask-386", "LIVE", [
        ("search_brain", {"query": "why was PEP 386 replaced"}, "2 passages, top hit PEP 386", ["pep-0386", "pep-0440"]),
        ("follow_edges", {"doc_id": "pep-0386", "relation": "superseded_by"}, "PEP 386 is superseded by PEP 440", ["pep-0440"]),
        ("get_decision", {"doc_id": "pep-0440"}, "Read PEP 440 rationale", ["pep-0440"]),
    ], terminal))

    # --- ask: unsupported ---
    terminal = dict(
        type="answer_completed", answer=None, abstained=True,
        abstain_reason="The retrieved decisions record authors only; they do not establish who currently owns Python packaging.",
        citations=[], inspected_doc_ids=["pep-0440", "pep-0621"], evidence_edges=[], as_of=SNAP,
        provenance=prov("LIVE", ["pep-0440", "pep-0621"], 1))
    dump("stream_ask_unsupported.json", events("req-ask-unsupported", "LIVE", [
        ("search_brain", {"query": "who currently owns Python packaging"}, "2 passages, none name a current owner",
         ["pep-0440", "pep-0621"]),
    ], terminal))

    # --- ask: missing successor (563 -> 649, 749 not in corpus) ---
    terminal = dict(
        type="answer_completed", abstained=False, abstain_reason=None, as_of=SNAP,
        answer=("PEP 563 is Superseded. Its Superseded-By header names PEP 649 and PEP 749. PEP 649 is in the corpus "
                "(Final, Replaces: 563); PEP 749 is not in this corpus snapshot, so nothing from it can be cited here."),
        citations=[cite("pep-0563", "Superseded-By: 649, 749", "Header"), cite("pep-0649", "Replaces: 563", "Header")],
        inspected_doc_ids=["pep-0563", "pep-0649"],
        evidence_edges=[
            edge("e1", "pep-0563", "pep-0649", "superseded_by", "source_header", True,
                 [dict(doc_id="pep-0563", quote="Superseded-By: 649, 749", locator="Header")]),
            edge("e2", "pep-0563", "pep-0749", "superseded_by", "source_header", False,
                 [dict(doc_id="pep-0563", quote="Superseded-By: 649, 749", locator="Header")]),
            edge("e3", "pep-0649", "pep-0563", "replaces", "source_header", True,
                 [dict(doc_id="pep-0649", quote="Replaces: 563", locator="Header")]),
        ],
        provenance=prov("LOCAL", [], 0))
    dump("stream_ask_missing_successor_563.json", events("req-ask-563", "LOCAL", [
        ("search_brain", {"query": "what replaced PEP 563"}, "PEP 563 top hit (local snapshot)", ["pep-0563"]),
        ("follow_edges", {"doc_id": "pep-0563", "relation": "superseded_by"},
         "Successors: PEP 649 (in corpus), PEP 749 (not in corpus)", ["pep-0649"]),
    ], terminal))

    # --- review proposal ---
    sort_q = "One key change in the version scheme in this PEP relative to that in :pep:`386` is to sort top level developmental releases like ``X.Y.devN`` ahead of alpha releases like ``X.Ya1``."
    proposal = ("Sort development releases such as 1.0.dev1 between the last release candidate and the final "
                "release, so that dev builds sort after rc builds.")
    findings = [
        s.ProposalFinding(
            finding_id="f1", claim="Sort development releases between the last release candidate and the final release",
            doc_id="pep-0440", source_url=BY_ID["pep-0440"]["source_url"], quote=sort_q,
            locator="Changing the version scheme", relation="may_contradict", uncertainty="low",
            explanation="PEP 440 deliberately sorts top-level .devN releases ahead of alpha releases, the opposite of the proposed position."),
        s.ProposalFinding(
            finding_id="f2", claim="Dev builds sort after rc builds", doc_id="pep-0440",
            source_url=BY_ID["pep-0440"]["source_url"], quote=c440_why,
            locator="Changing the version scheme", relation="suggests_replacing", uncertainty="low",
            explanation="If accepted, this proposal would replace PEP 440's sort-order decision with the behaviour PEP 440 argued against. This is a suggestion, not an accepted change."),
    ]
    contacts = BY_ID["pep-0440"]["authors"]
    draft_md = ("# Proposal: sort development releases after release candidates\n\n"
                "Status: Draft (PROPOSAL, not accepted)\n"
                "Proposes-To-Replace: PEP 440, section \"Changing the version scheme\" (suggestion only)\n\n"
                "## Summary\n" + proposal + "\n\n## Conflicts found\n"
                "- PEP 440 sorts `X.Y.devN` ahead of alpha releases and gives a rationale; this proposal must address it.\n\n"
                "## Recorded contacts for PEP 440\n" + "\n".join(f"- {c}" for c in contacts) + "\n")
    terminal = dict(
        type="review_completed", findings=findings, inspected_doc_ids=["pep-0440"],
        evidence_edges=[
            edge("e1", "proposal", "pep-0440", "potential_conflict", "inferred", True,
                 [dict(doc_id="pep-0440", quote=sort_q, locator="Changing the version scheme")],
                 "The proposed sort position is the opposite of the one PEP 440 chose.", "low"),
            edge("e2", "proposal", "pep-0440", "proposes_to_replace", "proposal", True,
                 [dict(doc_id="pep-0440", quote=c440_why, locator="Changing the version scheme")],
                 "Suggestion only; PEP 440's status and edges are unchanged."),
        ],
        recorded_contacts=contacts, draft_md=draft_md, as_of=SNAP,
        provenance=prov("LIVE", ["pep-0440"], 2))
    dump("stream_review_proposal.json", events("req-review-1", "LIVE", [
        ("search_brain", {"query": proposal}, "Top hit PEP 440", ["pep-0440"]),
        ("find_conflicts", {"proposal": proposal, "doc_id": "pep-0440"}, "1 candidate conflict, 1 suggested replacement",
         ["pep-0440"]),
    ], terminal))

    # --- error ---
    dump("stream_error_model_unavailable.json", events("req-err-1", "LOCAL", [
        ("search_brain", {"query": "why was PEP 386 replaced"}, "2 passages (local snapshot)", ["pep-0386", "pep-0440"]),
    ], dict(type="error", code="model_unavailable", message="The model could not be reached; no answer was generated.",
            retryable=True)))

    # --- drafts ---
    did = "0b0e4b6e-5c7e-4a43-9d57-2f3b7a1c9e10"
    title = "Sort development releases after release candidates"
    ptr = ["pep-0440"]
    h = s.draft_content_hash(title, draft_md, ptr)
    base = dict(draft_id=did, content_hash=h, title=title, body_md=draft_md, proposes_to_replace=ptr, fixture=True)
    dump("draft_create_request.json", s.DraftCreateRequest(draft_id=did, title=title, body_md=draft_md, proposes_to_replace=ptr))
    dump("draft_pending.json", s.DraftRecord(**base, status="pending", provider_indexing="pending", retrieval_verification="pending"))
    dump("draft_indexed.json", s.DraftRecord(**base, status="indexed", provider_indexing="completed",
                                             retrieval_verification="verified", verified_via="hydradb"))
    dump("draft_indexed_local.json", s.DraftRecord(**base, status="indexed", provider_indexing="completed",
                                                   retrieval_verification="verified", verified_via="local_store"))
    dump("draft_failed.json", s.DraftRecord(**base, status="failed", provider_indexing="failed",
                                            retrieval_verification="pending", error="HydraDB did not finish indexing the draft."))
    dump("draft_conflict.json", s.ErrorBody(code="draft_conflict", retryable=False,
                                            message="draft_id already exists with different content; save as a new draft."))
    print("fixtures written:", len(list(OUT.glob('*.json'))))


if __name__ == "__main__":
    main()
