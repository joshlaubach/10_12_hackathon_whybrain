"""Fetch the committed PEP corpus snapshot and write data/peps/manifest.json.

Usage: python scripts/fetch_peps.py [--refresh]
Stdlib only. Chains are validated from Replaces/Superseded-By headers; targets
outside the corpus are recorded as gaps (never silently dropped).
"""
import hashlib, json, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

RAW = "https://raw.githubusercontent.com/python/peps/main/peps/pep-{n:04d}.rst"
URL = "https://peps.python.org/pep-{n:04d}/"
OUT = Path(__file__).resolve().parent.parent / "data" / "peps"
SEEDS = [8, 287, 291, 314, 333, 345, 386, 425, 426, 440, 484, 508, 517, 518, 563,
         566, 585, 604, 621, 643, 649, 3107, 3156, 3333]
# Deliberately left out so the corpus has a real missing-successor case:
# PEP 563 is Superseded-By 649 and 749; PEP 749 is not in the snapshot.
EXCLUDED = [749]


def nums(s):
    return [int(x) for x in re.findall(r"\d+", s or "")]


def parse_headers(text):
    h, k = {}, None
    for line in text.split("\n"):
        if not line.strip():
            break
        m = re.match(r"^([A-Za-z-]+):\s*(.*)$", line)
        if m:
            k = m.group(1)
            h[k] = m.group(2)
        elif k and line.startswith((" ", "\t")):
            h[k] += " " + line.strip()
    return h


def fetch(n):
    path = OUT / f"pep-{n:04d}.rst"
    if path.exists() and "--refresh" not in sys.argv:
        return n, path.read_text(encoding="utf-8")
    text = urllib.request.urlopen(RAW.format(n=n), timeout=30).read().decode("utf-8")
    path.write_text(text, encoding="utf-8")
    return n, text


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(8) as ex:
        texts = dict(ex.map(fetch, SEEDS))
    in_corpus = set(SEEDS)
    docs, gaps = [], []
    for n in sorted(texts):
        h = parse_headers(texts[n])
        res = re.search(r"https?://[^\s>`]+", h.get("Resolution", ""))
        rep, sup = nums(h.get("Replaces")), nums(h.get("Superseded-By"))
        for t in sup:
            if t not in in_corpus:
                gaps.append({"doc_id": f"pep-{n:04d}", "missing_successor": f"pep-{t:04d}"})
        docs.append({
            "doc_id": f"pep-{n:04d}", "pep": n, "file": f"pep-{n:04d}.rst",
            "source_url": URL.format(n=n), "title": h.get("Title", ""),
            "source_status": h.get("Status", ""),
            "authors": [a.strip() for a in re.split(r",\s*(?=[^<>]*(?:<|$))", h.get("Author", "")) if a.strip()],
            "discussions_to": h.get("Discussions-To") or None,
            "resolution_url": res.group(0) if res else None,
            "replaces": [f"pep-{t:04d}" for t in rep],
            "superseded_by": [f"pep-{t:04d}" for t in sup],
            "sha256": hashlib.sha256(texts[n].encode()).hexdigest(),
        })
    snap = hashlib.sha256("".join(d["doc_id"] + d["sha256"] for d in docs).encode()).hexdigest()[:12]
    manifest = {
        "snapshot_id": f"peps-{snap}", "source": "https://github.com/python/peps (main)",
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "review_status": "candidate",  # Josh sets "approved" after review
        "excluded_for_gap_demo": [f"pep-{n:04d}" for n in EXCLUDED],
        "missing_successors": gaps, "docs": docs,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"{len(docs)} docs, snapshot {manifest['snapshot_id']}, gaps: {gaps}")


if __name__ == "__main__":
    main()
