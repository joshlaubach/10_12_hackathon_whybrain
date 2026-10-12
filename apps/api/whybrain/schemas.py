"""Why Brain API contract: the single source of truth.

Edit here, then run `python scripts/export_contract.py` and
`python scripts/make_fixtures.py` (one `contract:` commit, logged in
docs/CONTRACT_CHANGES.md). TypeScript types and fixtures are generated from this file.
"""
from __future__ import annotations

import hashlib
import json
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

Mode = Literal["LIVE", "LOCAL", "REPLAY"]
Uncertainty = Literal["low", "medium", "high"]
ToolName = Literal["search_brain", "get_decision", "follow_edges", "check_status", "find_conflicts"]
ErrorCode = Literal[
    "model_unavailable", "hydradb_unavailable", "retrieval_failed", "invalid_request",
    "draft_conflict", "not_found", "stream_interrupted", "timeout", "tool_limit_exceeded",
    "internal_error",
]
EdgeRelation = Literal["replaces", "superseded_by", "proposes_to_replace", "potential_conflict"]
# source_header: authoritative, copied from the PEP's own headers.
# proposal: text under review or a saved draft; never authoritative.
# inferred: judged by the model; always carries uncertainty.
EdgeOrigin = Literal["source_header", "proposal", "inferred"]
FindingRelation = Literal["may_contradict", "may_repeat", "suggests_replacing"]


class Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------- documents ----------

class DocRef(Base):
    doc_id: str
    source_url: str
    in_corpus: bool


class Document(Base):
    doc_id: str = Field(description="Stable id, e.g. pep-0386")
    source_url: str
    title: str
    source_status: str = Field(description="Verbatim source Status header: Final, Superseded, Withdrawn, ...")
    authors: list[str] = Field(description="Recorded contacts from the source, not current owners")
    discussions_to: str | None = None
    resolution_url: str | None = None
    replaces: list[DocRef] = Field(description="From the source Replaces header")
    superseded_by: list[DocRef] = Field(description="From the source Superseded-By header")
    missing_successors: list[str] = Field(description="superseded_by ids that are not in the corpus snapshot")
    snapshot_id: str


class Section(Base):
    locator: str = Field(description="Heading text, or 'Header' for the header block")
    heading: str
    text: str


class DecisionDetail(Document):
    body_text: str
    sections: list[Section]


class DecisionList(Base):
    snapshot_id: str
    documents: list[Document]


# ---------- evidence ----------

class EvidenceRef(Base):
    doc_id: str
    quote: str = Field(description="Whitespace-normalised substring of the source document")
    locator: str


class Citation(EvidenceRef):
    source_url: str


class EvidenceEdge(Base):
    edge_id: str
    source_doc_id: str = Field(description="A doc_id, 'proposal', or 'draft:<draft_id>'")
    target_doc_id: str
    relation: EdgeRelation
    origin: EdgeOrigin
    target_in_corpus: bool = Field(description="False renders as an explicit gap (missing successor)")
    supporting_evidence: list[EvidenceRef]
    explanation: str | None = None
    uncertainty: Uncertainty | None = None

    @model_validator(mode="after")
    def _semantics(self) -> "EvidenceEdge":
        if self.origin == "source_header":
            if self.relation not in ("replaces", "superseded_by"):
                raise ValueError("source_header edges are replaces/superseded_by only")
            if not self.supporting_evidence:
                raise ValueError("source_header edges must cite the header text")
            if self.uncertainty is not None:
                raise ValueError("source_header edges carry no uncertainty")
        if self.relation == "proposes_to_replace" and self.origin != "proposal":
            raise ValueError("proposes_to_replace must have origin 'proposal'")
        if self.origin == "proposal" and self.relation in ("replaces", "superseded_by"):
            raise ValueError("a proposal can never create an authoritative replaces/superseded_by edge")
        if self.relation == "potential_conflict":
            if self.origin != "inferred" or self.uncertainty is None or not self.supporting_evidence:
                raise ValueError("potential_conflict is inferred and needs uncertainty and evidence")
        return self


class Provenance(Base):
    """What actually happened for this request. The UI shows mode_used, never health config.

    LIVE means HydraDB supplied evidence that is actually used in the response and the
    model call completed successfully. Attempted or failed calls do not qualify.
    """
    mode_used: Mode
    hydradb_requests: int = Field(ge=0, description="Attempted")
    hydradb_failures: int = Field(ge=0)
    hydradb_evidence_doc_ids: list[str] = Field(
        description="Doc ids returned by successful HydraDB calls and used in this response")
    model_requests: int = Field(ge=0, description="Attempted")
    model_failures: int = Field(ge=0)
    model_completed: bool

    @model_validator(mode="after")
    def _mode(self) -> "Provenance":
        if self.hydradb_failures > self.hydradb_requests or self.model_failures > self.model_requests:
            raise ValueError("failures cannot exceed requests")
        if self.mode_used == "LIVE" and not (self.model_completed and self.hydradb_evidence_doc_ids):
            raise ValueError("LIVE requires a completed model call and HydraDB evidence used in the response")
        if self.mode_used == "REPLAY" and (self.hydradb_requests or self.model_requests or self.model_completed):
            raise ValueError("REPLAY makes no HydraDB or model requests")
        return self


class ProposalFinding(Base):
    finding_id: str
    claim: str = Field(description="The part of the proposal this finding concerns")
    doc_id: str
    source_url: str
    quote: str
    locator: str
    relation: FindingRelation = Field(
        description="suggests_replacing means the proposal would replace this decision if accepted; "
                    "UI copy: 'Suggested replacement (not an accepted change)'")
    explanation: str
    uncertainty: Uncertainty


# ---------- stream ----------

class _Event(Base):
    request_id: str
    seq: int = Field(ge=0, description="Strictly increasing within a request, starting at 0")
    fixture: bool = Field(default=False, description="True for recorded fixtures; the UI shows 'Mock data'")


class RequestStarted(_Event):
    type: Literal["request_started"]
    mode: Mode = Field(description="Intended mode. The answer's mode is provenance.mode_used")
    snapshot_id: str

    @model_validator(mode="after")
    def _seq0(self) -> "RequestStarted":
        if self.seq != 0:
            raise ValueError("request_started has seq 0")
        return self


class ToolStarted(_Event):
    type: Literal["tool_started"]
    call_id: str
    tool: ToolName
    args: dict[str, Any]


class ToolCompleted(_Event):
    type: Literal["tool_completed"]
    call_id: str
    tool: ToolName
    ok: bool
    summary: str
    doc_ids: list[str]


def _check_evidence(inspected: list[str], edges: list[EvidenceEdge]) -> None:
    seen = set(inspected)
    for e in edges:
        if e.target_in_corpus and e.target_doc_id not in seen:
            raise ValueError(f"edge {e.edge_id}: in-corpus target {e.target_doc_id} not in inspected_doc_ids")
        if not e.target_in_corpus and e.target_doc_id in seen:
            raise ValueError(f"edge {e.edge_id}: gap target {e.target_doc_id} cannot be inspected")


class AnswerCompleted(_Event):
    type: Literal["answer_completed"]
    answer: str | None
    abstained: bool
    abstain_reason: str | None = None
    citations: list[Citation]
    inspected_doc_ids: list[str]
    evidence_edges: list[EvidenceEdge]
    as_of: str = Field(description="Corpus snapshot id; conclusions hold as of this snapshot")
    provenance: Provenance

    @model_validator(mode="after")
    def _check(self) -> "AnswerCompleted":
        if self.abstained != (self.answer is None):
            raise ValueError("abstained iff answer is null")
        if self.abstained and self.citations:
            raise ValueError("an abstention cites nothing")
        _check_evidence(self.inspected_doc_ids, self.evidence_edges)
        if not set(c.doc_id for c in self.citations) <= set(self.inspected_doc_ids):
            raise ValueError("citations must come from inspected documents")
        p = self.provenance
        if p.mode_used == "LIVE" and not self.abstained:
            if not set(p.hydradb_evidence_doc_ids) & {c.doc_id for c in self.citations}:
                raise ValueError("LIVE answer must cite a document supplied by HydraDB")
        return self


class ReviewCompleted(_Event):
    type: Literal["review_completed"]
    findings: list[ProposalFinding]
    inspected_doc_ids: list[str]
    evidence_edges: list[EvidenceEdge]
    recorded_contacts: list[str] = Field(description="Authors recorded in the cited sources; not current owners")
    draft_md: str
    as_of: str
    provenance: Provenance

    @model_validator(mode="after")
    def _check(self) -> "ReviewCompleted":
        _check_evidence(self.inspected_doc_ids, self.evidence_edges)
        if not {f.doc_id for f in self.findings} <= set(self.inspected_doc_ids):
            raise ValueError("findings must come from inspected documents")
        p = self.provenance
        if p.mode_used == "LIVE" and self.findings:
            if not set(p.hydradb_evidence_doc_ids) & {f.doc_id for f in self.findings}:
                raise ValueError("LIVE review must use a document supplied by HydraDB")
        return self


class StreamError(_Event):
    type: Literal["error"]
    code: ErrorCode
    message: str
    retryable: bool


StreamEvent = Annotated[
    Union[RequestStarted, ToolStarted, ToolCompleted, AnswerCompleted, ReviewCompleted, StreamError],
    Field(discriminator="type"),
]
TERMINAL_TYPES = ("answer_completed", "review_completed", "error")


# ---------- drafts ----------

DraftStatus = Literal["pending", "indexed", "failed"]


class DraftCreateRequest(Base):
    draft_id: str = Field(min_length=8, description="Client-generated UUID; also the idempotency key")
    title: str = Field(min_length=1)
    body_md: str = Field(min_length=1)
    proposes_to_replace: list[str] = Field(description="doc_ids; a proposal, never an accepted replacement")


class DraftRecord(Base):
    """A saved proposal. It never changes accepted documents or authoritative edges.

    Provider indexing completion and retrieval verification are tracked separately.
    `status` is 'indexed' only when the provider finished indexing AND a retrieval of
    this draft_id read from the real store (HydraDB, or the explicit local store in
    LOCAL mode), not from the backend's cached save response.
    """
    draft_id: str
    content_hash: str
    title: str
    body_md: str
    proposes_to_replace: list[str]
    label: Literal["PROPOSAL"] = "PROPOSAL"
    status: DraftStatus
    provider_indexing: Literal["pending", "completed", "failed"]
    retrieval_verification: Literal["pending", "verified", "failed"]
    verified_via: Literal["hydradb", "local_store"] | None = None
    error: str | None = None
    fixture: bool = False

    @model_validator(mode="after")
    def _status(self) -> "DraftRecord":
        if self.status == "indexed" and not (
            self.provider_indexing == "completed"
            and self.retrieval_verification == "verified"
            and self.verified_via is not None
        ):
            raise ValueError("indexed requires completed indexing and a verified retrieval from the store")
        if self.status == "pending" and (
            self.provider_indexing == "failed" or self.retrieval_verification == "failed"
        ):
            raise ValueError("pending cannot hold a failed stage")
        if self.status == "failed" and not self.error:
            raise ValueError("failed requires an error message")
        return self


def draft_content_hash(title: str, body_md: str, proposes_to_replace: list[str]) -> str:
    canon = json.dumps(
        {"title": title.strip(), "body_md": body_md.strip(), "proposes_to_replace": sorted(proposes_to_replace)},
        sort_keys=True, ensure_ascii=False)
    return "sha256:" + hashlib.sha256(canon.encode()).hexdigest()


# ---------- requests and misc ----------

class AskRequest(Base):
    question: str = Field(min_length=1)
    mode_preference: Literal["AUTO", "REPLAY"] = "AUTO"


class ProposalReviewRequest(Base):
    proposal_text: str = Field(min_length=1)
    mode_preference: Literal["AUTO", "REPLAY"] = "AUTO"


class ErrorBody(Base):
    code: ErrorCode
    message: str
    request_id: str | None = None
    retryable: bool


class CorpusCounts(Base):
    documents: int
    source_header_edges: int
    missing_successors: int


class Configured(Base):
    hydradb: bool
    anthropic: bool


class HealthResponse(Base):
    status: Literal["ok"]
    configured: Configured
    snapshot_id: str
    corpus: CorpusCounts
    note: str = "Configuration only. The mode of an answer is provenance.mode_used, never this."


MODELS: list[type[BaseModel]] = [
    Document, DecisionDetail, DecisionList, Citation, EvidenceRef, EvidenceEdge, Provenance,
    ProposalFinding, RequestStarted, ToolStarted, ToolCompleted, AnswerCompleted, ReviewCompleted,
    StreamError, DraftCreateRequest, DraftRecord, AskRequest, ProposalReviewRequest, ErrorBody,
    HealthResponse,
]
