"""Committed corpus snapshot: documents, sections and deterministic header edges.

Supersession comes only from the source headers in data/peps (via manifest.json), never
from the model or from HydraDB's extracted triplets.
"""
import json
import re
from functools import lru_cache
from pathlib import Path

from . import schemas as s
from .quotes import norm

ROOT = Path(__file__).resolve().parents[3]
PEPS = ROOT / "data" / "peps"
MAN = json.loads((PEPS / "manifest.json").read_text())
SNAP = MAN["snapshot_id"]
BY_ID = {d["doc_id"]: d for d in MAN["docs"]}
URL = "https://peps.python.org/pep-{n:04d}/"


def pep_url(doc_id: str) -> str:
    return URL.format(n=int(doc_id.split("-")[1]))


@lru_cache(maxsize=None)
def text(doc_id: str) -> str:
    return (PEPS / BY_ID[doc_id]["file"]).read_text()


def ref(doc_id: str) -> s.DocRef:
    return s.DocRef(doc_id=doc_id, source_url=pep_url(doc_id), in_corpus=doc_id in BY_ID)


def document(doc_id: str) -> s.Document:
    d = BY_ID[doc_id]
    return s.Document(
        doc_id=doc_id, source_url=d["source_url"], title=d["title"], source_status=d["source_status"],
        authors=d["authors"], discussions_to=d["discussions_to"], resolution_url=d["resolution_url"],
        replaces=[ref(x) for x in d["replaces"]], superseded_by=[ref(x) for x in d["superseded_by"]],
        missing_successors=[x for x in d["superseded_by"] if x not in BY_ID], snapshot_id=SNAP)


@lru_cache(maxsize=None)
def sections(doc_id: str) -> tuple[s.Section, ...]:
    lines, out, i = text(doc_id).split("\n"), [], 0
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
    return tuple(out)


def detail(doc_id: str) -> s.DecisionDetail:
    return s.DecisionDetail(**document(doc_id).model_dump(), body_text=text(doc_id), sections=list(sections(doc_id)))


def locate(doc_id: str, quote: str) -> str:
    q = norm(quote)
    for sec in sections(doc_id):
        if q in norm(sec.text):
            return sec.locator
    return "Document"


def header_edges(doc_id: str) -> list[tuple[str, str, str]]:
    """(relation, target_doc_id, quote) from the document's own Replaces / Superseded-By lines."""
    d, out = BY_ID[doc_id], []
    for line in sections(doc_id)[0].text.split("\n"):
        key = line.split(":", 1)[0].strip().lower()
        if key == "superseded-by":
            out += [("superseded_by", t, line.strip()) for t in d["superseded_by"]]
        elif key == "replaces":
            out += [("replaces", t, line.strip()) for t in d["replaces"]]
    return out


def counts() -> s.CorpusCounts:
    return s.CorpusCounts(
        documents=len(BY_ID),
        source_header_edges=sum(len(d["replaces"]) + len(d["superseded_by"]) for d in MAN["docs"]),
        missing_successors=len(MAN["missing_successors"]))
