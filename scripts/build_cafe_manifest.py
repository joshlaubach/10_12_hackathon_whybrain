"""Build data/cafe/manifest.json from the Maple Street Café decision records (a fictional sample).

Usage (repo root): uv run --project apps/api python scripts/build_cafe_manifest.py
Header fields are parsed from each dr-NNN.txt; edges come only from the Replaces/Superseded-By lines.
DR-021 is deliberately absent from the corpus: it appears only as a missing successor.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "cafe"
URL = "https://github.com/joshlaubach/10_12_hackathon_whybrain/blob/main/data/cafe/{doc_id}.txt"
EXCLUDED = ["dr-021"]


def ids(value: str) -> list[str]:
    return [f"dr-{int(n):03d}" for n in re.findall(r"DR-(\d+)", value or "")]


def header(text: str) -> dict:
    out = {}
    for line in text.split("\n\n", 1)[0].splitlines():
        k, _, v = line.partition(":")
        out[k.strip().lower()] = v.strip()
    return out


def main():
    docs = []
    for p in sorted(DIR.glob("dr-*.txt")):
        text, h = p.read_text(), header(p.read_text())
        doc_id = p.stem
        docs.append({
            "doc_id": doc_id, "num": int(doc_id.split("-")[1]), "file": p.name,
            "source_url": URL.format(doc_id=doc_id), "title": h["title"], "source_status": h["status"],
            "authors": [a.strip() for a in h["author"].split(",")],
            "discussions_to": h.get("discussions-to"), "resolution_url": None,
            "replaces": ids(h.get("replaces", "")), "superseded_by": ids(h.get("superseded-by", "")),
            "sha256": hashlib.sha256(text.encode()).hexdigest()})
    have = {d["doc_id"] for d in docs}
    gaps = [{"doc_id": d["doc_id"], "missing_successor": t} for d in docs for t in d["superseded_by"] if t not in have]
    snap = hashlib.sha256("".join(d["doc_id"] + d["sha256"] for d in docs).encode()).hexdigest()[:12]
    manifest = {
        "snapshot_id": f"cafe-{snap}", "source": "Maple Street Café: a FICTIONAL sample decision log (data/cafe)",
        "fictional": True, "fetched_at": "2026-10-12", "review_status": "candidate",
        "excluded_for_gap_demo": EXCLUDED, "missing_successors": gaps, "docs": docs}
    (DIR / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(docs)} docs, snapshot {manifest['snapshot_id']}, gaps: {gaps}")


if __name__ == "__main__":
    main()
