"""Committed corpus snapshot: documents, sections and deterministic header edges.

Supersession comes only from the source headers in the corpus (via manifest.json), never
from the model or from HydraDB's extracted triplets.

CORPUS=peps (default) or CORPUS=cafe selects the corpus at import. With no setting every value
below is exactly what it was before CORPUS existed.
"""
import json
import os
import re
from functools import lru_cache
from pathlib import Path

from . import schemas as s
from .quotes import norm

ROOT = Path(__file__).resolve().parents[3]

CORPORA = {
    "peps": dict(
        name="peps", data_dir=ROOT / "data" / "peps", id_fmt="pep-{n:04d}", id_re=r"pep[-\s]?0*(\d{1,4})",
        url_fmt="https://peps.python.org/pep-{n:04d}/", noun="a corpus of Python Enhancement Proposals",
        accepted_collection="wb_demo", drafts_collection="wb_dev_drafts", sample_note=None, tidy=False,
        review_nudge=""),
    "cafe": dict(
        name="cafe", data_dir=ROOT / "data" / "cafe", id_fmt="dr-{n:03d}", id_re=r"\bdr[-\s]?0*(\d{1,3})\b",
        url_fmt="https://github.com/joshlaubach/10_12_hackathon_whybrain/blob/main/data/cafe/dr-{n:03d}.txt",
        noun="a log of decision records (DR) for Maple Street Café, a fictional sample café",
        accepted_collection="wb_cafe", drafts_collection="wb_cafe_drafts",
        sample_note="Maple Street Café is a fictional sample corpus.", tidy=True,
        review_nudge=(" If the proposal reverses the stated rationale of a decision (it reinstates something the "
                      "decision dropped for the reasons it gives in its Why or Context), report may_contradict for "
                      "that decision, in addition to any suggests_replacing finding.")),
}
CFG = CORPORA[os.environ.get("CORPUS", "peps")]
DATA_DIR = CFG["data_dir"]
PEPS = DATA_DIR  # historical name
MAN = json.loads((DATA_DIR / "manifest.json").read_text())
SNAP = MAN["snapshot_id"]
BY_ID = {d["doc_id"]: d for d in MAN["docs"]}
ID_RE = re.compile(CFG["id_re"], re.I)


def doc_id_for(n: int) -> str:
    return CFG["id_fmt"].format(n=n)


def mentioned(text_: str) -> list[str]:
    """Corpus doc ids named in free text (e.g. 'PEP 386', 'dr-14'), in order, without duplicates."""
    return [d for d in dict.fromkeys(doc_id_for(int(n)) for n in ID_RE.findall(text_)) if d in BY_ID]


def display(doc_id: str) -> str:
    """Short human label: pep-0386 -> 'PEP 386' (legacy rule), dr-014 -> 'DR-014'."""
    return doc_id.replace("pep-0", "PEP ") if CFG["name"] == "peps" else doc_id.upper()


def prose_ids(text_: str | None) -> str | None:
    """Normalise doc-id casing in answer prose (dr-014 -> DR-014). Only for corpora with tidy=True."""
    if not text_ or not CFG["tidy"]:
        return text_
    return re.sub(r"\b[a-z]+-\d+\b", lambda m: display(m.group()) if m.group().lower() in BY_ID else m.group(),
                  text_, flags=re.I)


def source_url(doc_id: str) -> str:
    return CFG["url_fmt"].format(n=int(doc_id.split("-")[1]))


pep_url = source_url  # historical name


@lru_cache(maxsize=None)
def text(doc_id: str) -> str:
    return (DATA_DIR / BY_ID[doc_id]["file"]).read_text()


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
