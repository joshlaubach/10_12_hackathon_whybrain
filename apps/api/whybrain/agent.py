"""POST /api/ask agent: HydraDB retrieval, header-derived edges, Sonnet answer, verified citations.

Orchestration is deterministic; the model only composes an answer from passages we hand it.
Mode honesty: LIVE only when HydraDB chunks used in the answer were returned for this request
and the model call completed. A model failure is an error (`model_unavailable`), never a fallback.
"""
import json
import os
import re
import uuid
from typing import Any, Callable, Iterator

from pydantic import TypeAdapter

from . import corpus
from . import schemas as s
from .hydra import Hydra, HydraError, load_env
from .quotes import norm, quote_in_source

MAX_TOOL_CALLS = 6
ACCEPTED_COLLECTION = os.environ.get("HYDRA_ACCEPTED_COLLECTION", corpus.CFG["accepted_collection"])
EVENT = TypeAdapter(s.StreamEvent)
STOP = set("the a an of to in is was why what and or for did do does that this it be by on with as are how who".split())


class ToolLimit(Exception):
    pass


# ---------- retrieval ----------

def _doc_from_title(title: str) -> str | None:
    m = corpus.ID_RE.search(title or "")
    d = corpus.doc_id_for(int(m.group(1))) if m else None
    return d if d in corpus.BY_ID else None


def hydra_search(query: str) -> dict:
    """-> {passages: [{doc_id, locator, text}], triplets: [...]}. Raises HydraError."""
    data = Hydra().query([ACCEPTED_COLLECTION], query, max_results=8, graph=True)
    passages = []
    for ch in data.get("chunks") or []:
        doc = _doc_from_title(ch.get("source_title") or ch.get("id") or "")
        body = ch.get("chunk_content") or ""
        if doc and body.strip():
            passages.append({"doc_id": doc, "locator": corpus.locate(doc, body[:200]), "text": body})
    trip = []
    for p in (data.get("graph_context") or {}).get("query_paths") or []:
        trip += p.get("triplets") or []
    return {"passages": passages, "triplets": trip}


def local_search(query: str) -> list[dict]:
    words = {w for w in re.findall(r"[a-z0-9]+", query.lower()) if w not in STOP and len(w) > 1}
    named = set(corpus.mentioned(query))
    scored = []
    for doc in corpus.BY_ID:
        for sec in corpus.sections(doc):
            toks = set(re.findall(r"[a-z0-9]+", (sec.heading + " " + sec.text).lower()))
            score = len(words & toks) + (5 if doc in named else 0)
            if score > 1:
                scored.append((score, doc, sec))
    scored.sort(key=lambda t: -t[0])
    return [{"doc_id": d, "locator": sec.locator, "text": sec.text[:1500]} for _, d, sec in scored[:8]]


def triplets_matching_headers(triplets: list[dict]) -> int:
    """Count HydraDB triplets that restate a header edge (signal only, never authority)."""
    header = {(d, r, t) for d in corpus.BY_ID for r, t, _ in corpus.header_edges(d)}
    n = 0

    def doc(e: dict) -> str | None:
        m = re.search(r"\d{1,4}", str(e.get("identifier") or e.get("name") or ""))
        return corpus.doc_id_for(int(m.group())) if m else None

    for t in triplets:
        a, b = doc(t.get("source") or {}), doc(t.get("target") or {})
        pred = (t.get("relation") or {}).get("canonical_predicate", "")
        if not (a and b):
            continue
        if pred in ("replaces", "supersedes"):
            n += (a, "replaces", b) in header or (b, "superseded_by", a) in header
        elif pred in ("superseded by", "superseded_by"):
            n += (a, "superseded_by", b) in header or (b, "replaces", a) in header
    return n


# ---------- model ----------

SYSTEM = (
    f"You answer questions about decisions in {corpus.CFG['noun']} using ONLY the "
    "passages provided. Reply with one JSON object and nothing else: "
    '{"supported": boolean, "answer": string|null, "citations": [{"doc_id": string, "quote": string}], '
    '"abstain_reason": string|null}. Rules: every quote must be copied verbatim (exact characters) from one '
    "passage as a single contiguous span of at most 300 characters, preferring complete sentences. State supersession only as given in "
    "HEADER FACTS; never infer it. Report statuses verbatim and say 'as of the corpus snapshot'. A Final "
    "document can still be superseded. If the passages do not establish an answer, set supported=false, "
    "answer=null, and say in abstain_reason what is missing. Authors are recorded contacts, not current owners."
)


def call_model(question: str, facts: str, passages: list[dict]) -> dict:
    """One Sonnet call. Raises on any failure (caller turns it into model_unavailable)."""
    import anthropic

    load_env()
    client = anthropic.Anthropic(timeout=60, max_retries=1)
    body = "\n\n".join(f"[{p['doc_id']} | {p['locator']}]\n{p['text']}" for p in passages)
    msg = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"), max_tokens=1500, system=SYSTEM,
        messages=[{"role": "user", "content": f"Question: {question}\n\nHEADER FACTS (from source headers):\n"
                                              f"{facts}\n\nPASSAGES:\n{body}"}])
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise ValueError("model returned no JSON object")
    return json.loads(m.group(0))


# ---------- the run ----------

class Run:
    def __init__(self, mode_intended: s.Mode):
        self.rid = f"req-{uuid.uuid4().hex[:12]}"
        self.seq = 0
        self.mode = mode_intended
        self.calls = 0

    def emit(self, **kw: Any) -> dict:
        ev = EVENT.validate_python({"request_id": self.rid, "seq": self.seq, **kw})
        self.seq += 1
        return json.loads(ev.model_dump_json())

    def tool(self, tool: str, args: dict, fn: Callable[[], tuple[str, list[str], Any]]) -> Iterator[dict]:
        """Yields tool_started, then tool_completed; the result is stored on self.result."""
        if self.calls >= MAX_TOOL_CALLS:
            raise ToolLimit()
        self.calls += 1
        cid = f"call-{self.calls}"
        yield self.emit(type="tool_started", call_id=cid, tool=tool, args=args)
        try:
            summary, ids, self.result = fn()
            ok = True
        except Exception as e:  # tool failure is reported, the caller decides what it means
            summary, ids, self.result, ok = f"failed: {type(e).__name__}", [], e, False
        yield self.emit(type="tool_completed", call_id=cid, tool=tool, ok=ok, summary=summary, doc_ids=ids)


def _focus_docs(question: str, retrieved: list[str]) -> list[str]:
    named = corpus.mentioned(question)
    return (named or retrieved[:1])[:2]


def _facts(docs: list[str]) -> str:
    out = []
    for d in docs:
        m = corpus.BY_ID[d]
        sb = ", ".join(f"{t}{'' if t in corpus.BY_ID else ' (NOT IN CORPUS)'}" for t in m["superseded_by"]) or "none"
        out.append(f"{d}: title={m['title']!r}; Status={m['source_status']}; Superseded-By={sb}; "
                   f"Replaces={', '.join(m['replaces']) or 'none'}")
    return "\n".join(out)


def _retrieve(run: "Run", query: str, have_hydra: bool):
    """HydraDB first; local snapshot search when HydraDB is unavailable or returns nothing.
    Returns (passages, hydra_doc_ids, hydradb_requests, hydradb_failures)."""
    passages, hydra_ids, req, fail = [], set(), 0, 0
    if have_hydra:
        req += 1
        for ev in run.tool("search_brain", {"query": query}, lambda: _search(query)):
            yield ev
        if isinstance(run.result, Exception):
            fail += 1
        else:
            passages = run.result["passages"]
            hydra_ids = {p["doc_id"] for p in passages}
    if not passages:
        for ev in run.tool("search_brain", {"query": query, "source": "local_snapshot"}, lambda: _local(query)):
            yield ev
        passages = [] if isinstance(run.result, Exception) else run.result
    return passages, hydra_ids, req, fail


def _no_replay(run_mode: str = "REPLAY") -> Iterator[dict]:
    run = Run("REPLAY")
    yield run.emit(type="request_started", mode="REPLAY", snapshot_id=corpus.SNAP)
    yield run.emit(type="error", code="invalid_request", retryable=False,
                   message="REPLAY recordings exist only for the PEP corpus.")


def replay(question: str) -> Iterator[dict]:
    """User-selected recorded playback: no HydraDB or model calls, labelled REPLAY and fixture=true."""
    q = question.lower()
    name = ("missing_successor_563" if "563" in q or "649" in q
            else "386_440" if "386" in q or "440" in q or "replaced" in q else "unsupported")
    for ev in json.loads((corpus.ROOT / "packages" / "contracts" / "fixtures" / f"stream_ask_{name}.json").read_text()):
        if ev["type"] == "request_started":
            ev["mode"] = "REPLAY"
        if ev["type"] == "answer_completed":
            ev["provenance"] = s.Provenance(
                mode_used="REPLAY", hydradb_requests=0, hydradb_failures=0, hydradb_evidence_doc_ids=[],
                model_requests=0, model_failures=0, model_completed=False).model_dump()
        yield ev


def ask(question: str, mode_preference: str = "AUTO") -> Iterator[dict]:
    if mode_preference == "REPLAY":
        yield from (replay(question) if corpus.CFG["name"] == "peps" else _no_replay())
        return
    load_env()
    have_hydra, have_model = bool(os.environ.get("HYDRADB_API_KEY")), bool(os.environ.get("ANTHROPIC_API_KEY"))
    run = Run("LIVE" if have_hydra and have_model else "LOCAL")
    yield run.emit(type="request_started", mode=run.mode, snapshot_id=corpus.SNAP)
    try:
        # 1. retrieval: HydraDB first; local snapshot search if it is unavailable or empty
        passages, hydra_ids, hdb_req, hdb_fail = yield from _retrieve(run, question, have_hydra)
        retrieved = list(dict.fromkeys(p["doc_id"] for p in passages))

        # 2. deterministic supersession from the focus documents' own headers
        focus = _focus_docs(question, retrieved)
        named = bool(corpus.mentioned(question))
        inspected = [] if named else list(dict.fromkeys(retrieved[:4]))
        for doc in focus:
            if doc not in inspected:
                inspected.append(doc)
            succ = [t for r, t, _ in corpus.header_edges(doc) if r == "superseded_by"]
            for ev in run.tool("follow_edges", {"doc_id": doc, "relation": "superseded_by"},
                               lambda d=doc, sc=succ: _follow(d, sc)):
                yield ev
            for t in succ:
                if t in corpus.BY_ID and t not in inspected and run.calls < MAX_TOOL_CALLS:
                    for ev in run.tool("get_decision", {"doc_id": t}, lambda t=t: (f"Read {t}", [t], t)):
                        yield ev
                    inspected.append(t)

        # 3. passages for the model: header lines + abstract of every inspected doc + retrieved chunks
        ctx = []
        ctx += [p for p in passages if p["doc_id"] in inspected]
        for d in inspected:
            for sec in corpus.sections(d):
                if sec.locator in ("Header", "Abstract"):
                    ctx.append({"doc_id": d, "locator": sec.locator, "text": sec.text[:1500]})
        seen, uniq = set(), []
        for p in ctx:
            k = (p["doc_id"], norm(p["text"])[:80])
            if k not in seen:
                seen.add(k)
                uniq.append(p)

        # 4. model; failure is an error, never a silent fallback
        try:
            out = call_model(question, _facts(inspected), uniq[:14])
            model_ok = True
        except Exception:
            yield run.emit(type="error", code="model_unavailable", retryable=True,
                           message="The model could not be reached; no answer was generated.")
            return

        # 5. verify citations: doc in the inspected set, quote a whitespace-normalised substring of source
        cits = []
        for c in out.get("citations") or []:
            d, q = c.get("doc_id"), c.get("quote") or ""
            if d in inspected and quote_in_source(q, corpus.text(d)):
                cits.append(s.Citation(doc_id=d, source_url=corpus.source_url(d), quote=norm(q),
                                       locator=corpus.locate(d, q)))
        supported = bool(out.get("supported")) and bool(out.get("answer")) and bool(cits)
        reason = None if supported else (out.get("abstain_reason") or "No verifiable passage supports an answer.")

        # 6. header edges for inspected documents only (gaps stay explicit)
        edges = []
        for d in inspected:
            for rel, tgt, quote in corpus.header_edges(d):
                in_c = tgt in corpus.BY_ID
                if in_c and tgt not in inspected:
                    continue
                edges.append(s.EvidenceEdge(
                    edge_id=f"{d}:{rel}:{tgt}", source_doc_id=d, target_doc_id=tgt, relation=rel,
                    origin="source_header", target_in_corpus=in_c,
                    supporting_evidence=[s.EvidenceRef(doc_id=d, quote=quote, locator="Header")]))
        if not supported:
            cits, edges = [], []  # an abstention cites nothing and draws nothing
        elif corpus.CFG["tidy"]:
            cited = {c.doc_id for c in cits}  # keep edges touching a cited document (gaps included)
            edges = [e for e in edges if e.source_doc_id in cited or e.target_doc_id in cited]
        used = {d for d in hydra_ids if d in inspected}
        live = model_ok and bool(used) and (not supported or bool(used & {c.doc_id for c in cits}))
        prov = s.Provenance(
            mode_used="LIVE" if live else "LOCAL", hydradb_requests=hdb_req, hydradb_failures=hdb_fail,
            hydradb_evidence_doc_ids=sorted(used) if live else [], model_requests=1, model_failures=0,
            model_completed=True)
        yield run.emit(
            type="answer_completed", answer=corpus.prose_ids(out["answer"]) if supported else None,
            abstained=not supported, abstain_reason=corpus.prose_ids(reason), citations=[c.model_dump() for c in cits], inspected_doc_ids=inspected,
            evidence_edges=[e.model_dump() for e in edges], as_of=corpus.SNAP, provenance=prov.model_dump())
    except ToolLimit:
        yield run.emit(type="error", code="tool_limit_exceeded", retryable=False,
                       message=f"The agent reached the limit of {MAX_TOOL_CALLS} tool calls.")
    except Exception as e:
        yield run.emit(type="error", code="internal_error", retryable=False, message=f"{type(e).__name__}: {e}")


def _search(question: str) -> tuple[str, list[str], Any]:
    r = hydra_search(question)
    ids = list(dict.fromkeys(p["doc_id"] for p in r["passages"]))
    n = len(r["triplets"])
    top = f", top hit {corpus.display(ids[0])}" if ids else ""
    return (f"HydraDB: {len(r['passages'])} passages{top}. HydraDB graph context: {n} triplets, "
            f"{triplets_matching_headers(r['triplets'])} match header edges (LLM-extracted, not used as authority)",
            ids, r)


def _local(question: str) -> tuple[str, list[str], Any]:
    p = local_search(question)
    ids = list(dict.fromkeys(x["doc_id"] for x in p))
    return f"{len(p)} passages from the local snapshot", ids, p


def _follow(doc: str, succ: list[str]) -> tuple[str, list[str], Any]:
    if not succ:
        return f"{doc} has no Superseded-By header", [], None
    gaps = [t for t in succ if t not in corpus.BY_ID]
    msg = ", ".join(f"{t} ({'in corpus' if t in corpus.BY_ID else 'not in corpus'})" for t in succ)
    return f"{doc} superseded by {msg}", [t for t in succ if t in corpus.BY_ID], gaps

# ---------- proposal review (bounded: one proposal text, at most 3 retrieved decisions) ----------

MAX_PROPOSAL_CHARS = 2000
REVIEW_SYSTEM = (
    "You review a PROPOSAL against recorded decisions, using ONLY the passages provided. Reply with one JSON "
    'object and nothing else: {"findings": [{"claim": string, "doc_id": string, "quote": string, '
    '"relation": "may_contradict"|"may_repeat"|"suggests_replacing", "explanation": string, '
    '"uncertainty": "low"|"medium"|"high"}]}. "claim" is the part of the proposal concerned. Each quote must be '
    "copied verbatim from one passage, a contiguous span of at most 300 characters, preferably a complete "
    "sentence. may_contradict: the proposal conflicts with what the decision says. may_repeat: the proposal "
    "restates something the decision already covers. suggests_replacing: accepting the proposal would replace "
    "the decision's stance; use it only for a decision that is still operative, never for one whose HEADER FACTS show a Superseded-By (if the proposal revives a superseded decision, that is may_repeat). If accepting the proposal would change the stance of an operative decision, include a suggests_replacing finding for it. The proposal is never authoritative and changes no accepted status. Return an "
    'empty findings list if nothing is supported by the passages. Judgements are inferred: set uncertainty honestly.'
)


def call_review_model(proposal: str, facts: str, passages: list[dict]) -> dict:
    import anthropic

    load_env()
    client = anthropic.Anthropic(timeout=60, max_retries=1)
    body = "\n\n".join(f"[{p['doc_id']} | {p['locator']}]\n{p['text']}" for p in passages)
    msg = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"), max_tokens=2000, system=REVIEW_SYSTEM + corpus.CFG["review_nudge"],
        messages=[{"role": "user", "content": f"PROPOSAL:\n{proposal}\n\nHEADER FACTS:\n{facts}\n\nPASSAGES:\n{body}"}])
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise ValueError("model returned no JSON object")
    return json.loads(m.group(0))


def _draft_md(proposal: str, findings: list[s.ProposalFinding], contacts: list[str]) -> str:
    """Deterministic draft: the proposal text as written plus the verified findings. Never model-authored."""
    targets = sorted({f.doc_id for f in findings if f.relation == "suggests_replacing"})
    conflicts = [f for f in findings if f.relation == "may_contradict"]
    md = ["# Proposal draft", "", "Status: Draft (PROPOSAL, not accepted)"]
    md.append("Proposes-To-Replace: " + (", ".join(corpus.display(t) for t in targets) + " (suggestion only)"
                                         if targets else "none"))
    md += ["", "## Summary", proposal.strip(), "", "## Conflicts found"]
    md += [f"- {corpus.display(f.doc_id)} ({f.locator}): {f.explanation}" for f in conflicts] or ["- none found"]
    md += ["", "## Recorded contacts"] + ([f"- {c}" for c in contacts] or ["- none"])
    return "\n".join(md) + "\n"


def review(proposal: str, mode_preference: str = "AUTO") -> Iterator[dict]:
    if mode_preference == "REPLAY" and corpus.CFG["name"] != "peps":
        yield from _no_replay()
        return
    if mode_preference == "REPLAY":
        for ev in json.loads((corpus.ROOT / "packages" / "contracts" / "fixtures"
                              / "stream_review_proposal.json").read_text()):
            if ev["type"] == "request_started":
                ev["mode"] = "REPLAY"
            if ev["type"] == "review_completed":
                ev["provenance"] = s.Provenance(
                    mode_used="REPLAY", hydradb_requests=0, hydradb_failures=0, hydradb_evidence_doc_ids=[],
                    model_requests=0, model_failures=0, model_completed=False).model_dump()
            yield ev
        return
    load_env()
    have_hydra, have_model = bool(os.environ.get("HYDRADB_API_KEY")), bool(os.environ.get("ANTHROPIC_API_KEY"))
    run = Run("LIVE" if have_hydra and have_model else "LOCAL")
    yield run.emit(type="request_started", mode=run.mode, snapshot_id=corpus.SNAP)
    try:
        passages, hydra_ids, hdb_req, hdb_fail = yield from _retrieve(run, proposal, have_hydra)
        inspected = list(dict.fromkeys(p["doc_id"] for p in passages))[:3]
        ctx = [p for p in passages if p["doc_id"] in inspected]
        for d in inspected:
            for sec in corpus.sections(d):
                if sec.locator in ("Header", "Abstract"):
                    ctx.append({"doc_id": d, "locator": sec.locator, "text": sec.text[:1500]})
        for ev in run.tool("find_conflicts", {"proposal": proposal[:200], "doc_ids": inspected},
                           lambda: _review_model(proposal, inspected, ctx)):
            yield ev
        if isinstance(run.result, Exception):
            yield run.emit(type="error", code="model_unavailable", retryable=True,
                           message="The model could not be reached; no review was generated.")
            return
        findings: list[s.ProposalFinding] = []
        for i, f in enumerate(run.result.get("findings") or [], 1):
            d, q = f.get("doc_id"), f.get("quote") or ""
            if d in inspected and quote_in_source(q, corpus.text(d)) and f.get("relation") in (
                    "may_contradict", "may_repeat", "suggests_replacing"):
                if f["relation"] == "suggests_replacing" and corpus.BY_ID[d]["superseded_by"]:
                    f["relation"] = "may_repeat"  # a superseded decision is not replaced again
                findings.append(s.ProposalFinding(
                    finding_id=f"f{i}", claim=str(f.get("claim") or "")[:300], doc_id=d, source_url=corpus.source_url(d),
                    quote=norm(q), locator=corpus.locate(d, q), relation=f["relation"],
                    explanation=str(f.get("explanation") or ""),
                    uncertainty=f.get("uncertainty") if f.get("uncertainty") in ("low", "medium", "high") else "medium"))
        edges = []
        for d in inspected:  # authoritative header edges only for decisions we actually read
            for rel, tgt, quote in corpus.header_edges(d):
                in_c = tgt in corpus.BY_ID
                if in_c and tgt not in inspected:
                    continue
                edges.append(s.EvidenceEdge(
                    edge_id=f"{d}:{rel}:{tgt}", source_doc_id=d, target_doc_id=tgt, relation=rel, origin="source_header",
                    target_in_corpus=in_c, supporting_evidence=[s.EvidenceRef(doc_id=d, quote=quote, locator="Header")]))
        for f in findings:  # proposal-origin edges: never replaces / superseded_by
            ev_ref = [s.EvidenceRef(doc_id=f.doc_id, quote=f.quote, locator=f.locator)]
            if f.relation == "may_contradict":
                edges.append(s.EvidenceEdge(
                    edge_id=f"proposal:potential_conflict:{f.finding_id}", source_doc_id="proposal",
                    target_doc_id=f.doc_id, relation="potential_conflict", origin="inferred", target_in_corpus=True,
                    supporting_evidence=ev_ref, explanation=f.explanation, uncertainty=f.uncertainty))
            elif f.relation == "suggests_replacing":
                edges.append(s.EvidenceEdge(
                    edge_id=f"proposal:proposes_to_replace:{f.finding_id}", source_doc_id="proposal",
                    target_doc_id=f.doc_id, relation="proposes_to_replace", origin="proposal", target_in_corpus=True,
                    supporting_evidence=ev_ref, explanation="Suggestion only; the decision's status and edges are unchanged."))
        contacts = list(dict.fromkeys(a for d in {f.doc_id for f in findings} for a in corpus.BY_ID[d]["authors"]))
        used = {d for d in hydra_ids if d in inspected}
        live = bool(used) and (not findings or bool(used & {f.doc_id for f in findings}))
        prov = s.Provenance(
            mode_used="LIVE" if live else "LOCAL", hydradb_requests=hdb_req, hydradb_failures=hdb_fail,
            hydradb_evidence_doc_ids=sorted(used) if live else [], model_requests=1, model_failures=0,
            model_completed=True)
        yield run.emit(
            type="review_completed", findings=[f.model_dump() for f in findings], inspected_doc_ids=inspected,
            evidence_edges=[e.model_dump() for e in edges], recorded_contacts=contacts,
            draft_md=_draft_md(proposal, findings, contacts), as_of=corpus.SNAP, provenance=prov.model_dump())
    except Exception as e:
        yield run.emit(type="error", code="internal_error", retryable=False, message=f"{type(e).__name__}: {e}")


def _review_model(proposal: str, inspected: list[str], ctx: list[dict]) -> tuple[str, list[str], Any]:
    out = call_review_model(proposal, _facts(inspected), ctx[:14])
    n = len(out.get("findings") or [])
    return f"{n} candidate finding(s) from {len(inspected)} decision(s); quotes verified next", inspected, out
