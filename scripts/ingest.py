"""Ingest the committed corpus into HydraDB (accepted decisions only; never drafts).

Usage (repo root): uv run --project apps/api python scripts/ingest.py [--collection wb_demo] [--workers 4]
CORPUS=cafe ingests data/cafe into wb_cafe instead (default CORPUS=peps, wb_demo).
Idempotent: documents already indexed are skipped. Priority docs go first. Progress goes to
scripts/.ingest_state.json. Indexing is asynchronous and slow (~1-2 min/doc), so run it early.
"""
import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "api"))

from whybrain import corpus  # noqa: E402
from whybrain.hydra import Hydra, HydraError  # noqa: E402

PRIORITY = ["pep-0386", "pep-0440", "pep-0563", "pep-0649", "pep-0333", "pep-3333", "pep-0291",
            "dr-014", "dr-002", "dr-016", "dr-005"]  # unknown ids for the other corpus are skipped
STATE = ROOT / "scripts" / (".ingest_state.json" if corpus.CFG["name"] == "peps" else f".ingest_state_{corpus.CFG['name']}.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", default=os.environ.get("HYDRA_ACCEPTED_COLLECTION", corpus.CFG["accepted_collection"]))
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    docs = corpus.BY_ID
    order = PRIORITY + sorted(set(docs) - set(PRIORITY))
    order = [d for d in order if d in docs]
    if a.collection.startswith("wb_cafe") != (corpus.CFG["name"] == "cafe"):
        sys.exit(f"refusing: corpus {corpus.CFG['name']} must not be ingested into collection {a.collection}")
    h = Hydra()
    state, lock, t0 = {}, threading.Lock(), time.time()

    def log(doc, **kw):
        with lock:
            state[doc] = {**state.get(doc, {}), **kw, "t": round(time.time() - t0, 1)}
            STATE.write_text(json.dumps({"collection": a.collection, "docs": state}, indent=1))
            print(f"[{state[doc]['t']:7.1f}s] {doc}: {kw}", flush=True)

    def one(doc):
        try:
            st = h.status(a.collection, doc)
            if st == "completed":
                return log(doc, state="already_indexed")
            if st not in ("not_found", "errored", "unknown"):  # accepted earlier and still indexing: just wait
                log(doc, state="resumed", provider_state=st)
                took = h.wait_indexed(a.collection, doc, timeout=1800)
                return log(doc, state="indexed", index_s=round(took, 1))
            h.ingest_text(a.collection, doc, (corpus.DATA_DIR / docs[doc]["file"]).read_text(),
                          {"title": docs[doc]["title"], "source_status": docs[doc]["source_status"]})
            log(doc, state="accepted")
            took = h.wait_indexed(a.collection, doc, timeout=1800)
            log(doc, state="indexed", index_s=round(took, 1))
        except HydraError as e:
            log(doc, state="failed", error=str(e))

    # submission order == priority order; the pool bounds concurrent uploads
    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(one, order))
    bad = [d for d, s in state.items() if s["state"] == "failed"]
    print(f"done in {time.time() - t0:.0f}s; failed: {bad or 'none'}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
