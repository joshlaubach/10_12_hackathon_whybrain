"""HydraDB spike: ingest PEP 386 (+440), wait for indexing, retrieve, then probe graph traversal.

Usage (repo root): uv run --project apps/api python scripts/spike_hydra.py
Reads HYDRADB_API_KEY and HYDRADB_COLLECTION from the backend .env; never prints the key.
Optional: HYDRADB_DATABASE (default: reuse the first existing database, else create 'whybrain').
Writes the raw responses to the path in SPIKE_OUT (default: scripts/.spike_out.json, do not commit).
"""
import json
import os
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
PEPS = ROOT / "data" / "peps"
API = os.environ.get("HYDRADB_BASE_URL", "https://api.hydradb.com")


def load_env():
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main():
    load_env()
    key = os.environ.get("HYDRADB_API_KEY")
    if not key:
        sys.exit("HYDRADB_API_KEY missing from .env")
    collection = os.environ.get("HYDRADB_COLLECTION") or "wb_dev_claude"
    h = {"Authorization": f"Bearer {key}", "API-Version": "2"}
    c = httpx.Client(base_url=API, headers=h, timeout=60)
    out, t = {}, {}

    def call(label, method, path, **kw):
        t0 = time.time()
        r = c.request(method, path, **kw)
        t[label] = round((time.time() - t0) * 1000)
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text[:500]}
        out[label] = {"http": r.status_code, "body": body}
        print(f"[{label}] HTTP {r.status_code} {t[label]}ms")
        if os.environ.get("SPIKE_VERBOSE"):
            print("   ", json.dumps(body)[:1500])
        return r.status_code, body

    # 1. database
    code, body = call("list_databases", "GET", "/databases")
    dbs = (body.get("data") or {}) if isinstance(body, dict) else {}
    print("  databases payload keys:", list(dbs) if isinstance(dbs, dict) else type(dbs))
    names = []
    if isinstance(dbs, dict):
        for k in ("databases", "tenants", "items"):
            for d in dbs.get(k) or []:
                names.append(d if isinstance(d, str) else d.get("database") or d.get("tenant_id") or d.get("name"))
    db = os.environ.get("HYDRADB_DATABASE") or (names[0] if names else "whybrain")
    print("  using database:", db, "(existing)" if db in names else "(will create)")
    if db not in names:
        call("create_database", "POST", "/databases", json={"database": db})
    for _ in range(60):
        _, b = call("db_status", "GET", "/databases/status", params={"database": db})
        infra = ((b.get("data") or {}).get("infra") or {})
        if infra.get("ready_for_ingestion"):
            print("  infra:", infra)
            break
        time.sleep(5)
    else:
        sys.exit("database never became ready_for_ingestion")

    # 2. ingest: upload is not searchable until indexing completes
    ids = {}
    for doc in ("pep-0386", "pep-0440"):
        with open(PEPS / f"{doc}.rst", "rb") as f:
            code, b = call(f"ingest_{doc}", "POST", "/context/ingest",
                           data={"type": "knowledge", "database": db, "collection": collection,
                                 "document_metadata": json.dumps([{"id": doc}])},
                           files=[("documents", (f"{doc}.txt", f, "text/plain"))])  # .rst is rejected (E1002)
        res = ((b.get("data") or {}).get("results") or [{}])[0]
        ids[doc] = res.get("id")
        if res.get("status") == "failed":
            sys.exit(f"ingest rejected {doc}: {res.get('error_code')} {res.get('error')}")
        print(f"  {doc}: id={ids[doc]} status={res.get('status') or res.get('indexing_status')}")
    t_ing = time.time()
    for doc, sid in ids.items():
        for _ in range(150):
            _, b = call(f"status_{doc}", "GET", "/context/status",
                        params={"database": db, "collection": collection, "ids": sid})
            st = ((b.get("data") or {}).get("statuses") or [{}])[0]
            if st.get("indexing_status") == "completed":
                break
            if st.get("indexing_status") == "errored":
                sys.exit(f"{doc} errored: {st.get('error_message')}")
            time.sleep(3)
        else:
            sys.exit(f"{doc} not indexed in time")
    print(f"  indexing wait: {round(time.time() - t_ing, 1)}s")

    # 3. retrieve with graph context
    q = {"database": db, "collections": [collection], "type": "knowledge",
         "query": "Why was PEP 386 replaced, and what superseded it?",
         "graph_context": True, "max_results": 8, "mode": "thinking"}
    code, b = call("query", "POST", "/query", json=q)
    d = b.get("data") or {}
    print("  data keys:", list(d))
    for ch in d.get("chunks") or []:
        print("  chunk", ch.get("source_title") or ch.get("id"), "| score", ch.get("relevancy_score"),
              "|", (ch.get("chunk_content") or "")[:90].replace("\n", " "))

    # 4. graph operations
    for doc in ("pep-0386",):
        code, b = call(f"relations_{doc}", "GET", "/context/relations",
                       params={"database": db, "collection": collection, "id": ids[doc], "type": "knowledge"})
        rels = (b.get("data") or {}).get("relations") or []
        flat = [r for grp in rels for r in grp.get("relations", [])]
        print(f"  relations for {doc}: {len(flat)}")
        for r in flat[:15]:
            print("   ", r.get("source_entity_id"), "-", r.get("canonical_predicate") or r.get("raw_predicate"),
                  "->", r.get("target_entity_id"), "|", (r.get("context") or "")[:70].replace("\n", " "))
        code, b = call(f"subgraph_{doc}", "GET", f"/context/{ids[doc]}/subgraph",
                       params={"database": db, "collection": collection, "type": "knowledge", "depth": 3})
        print("  subgraph relation groups:", len((b.get("data") or {}).get("relations") or []))

    print("latency ms:", t)
    p = Path(os.environ.get("SPIKE_OUT", ROOT / "scripts" / ".spike_out.json"))
    p.write_text(json.dumps({"database": db, "collection": collection, "ids": ids, "latency_ms": t, "raw": out}, indent=1))
    print("raw responses ->", p)


if __name__ == "__main__":
    main()
