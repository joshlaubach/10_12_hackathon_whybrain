"""Thin HydraDB v2 adapter (REST via httpx). Facts: docs/hydradb-notes.md.

Ingestion is asynchronous: an accepted upload is not searchable until `status` reports
indexing_status == "completed". `.rst` is rejected (E1002), so text is uploaded as `.txt`.
"""
import json
import os
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]


def load_env(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


class HydraError(Exception):
    pass


class Hydra:
    def __init__(self, database: str | None = None, timeout: float = 30):
        load_env()
        key = os.environ.get("HYDRADB_API_KEY")
        if not key:
            raise HydraError("HYDRADB_API_KEY missing")
        self.database = database or os.environ.get("HYDRADB_DATABASE") or "default-tenant"
        self.http = httpx.Client(
            base_url=os.environ.get("HYDRADB_BASE_URL", "https://api.hydradb.com"),
            headers={"Authorization": f"Bearer {key}", "API-Version": "2"}, timeout=timeout)

    def _json(self, r: httpx.Response) -> dict:
        try:
            body = r.json()
        except ValueError:
            raise HydraError(f"HTTP {r.status_code}: non-JSON response")
        if r.status_code >= 400 or body.get("success") is False and not body.get("data"):
            raise HydraError(f"HTTP {r.status_code}: {(body.get('error') or {}).get('message') or body}")
        return body

    def ingest_text(self, collection: str, doc_id: str, text: str, metadata: dict | None = None) -> dict:
        """Returns the per-file result; raises HydraError when the upload is rejected."""
        meta = json.dumps([{"id": doc_id, "additional_metadata": metadata or {}}])
        r = self.http.post("/context/ingest", data={
            "type": "knowledge", "database": self.database, "collection": collection,
            "document_metadata": meta}, files=[("documents", (f"{doc_id}.txt", text.encode(), "text/plain"))])
        res = ((self._json(r).get("data") or {}).get("results") or [{}])[0]
        if res.get("status") == "failed":
            raise HydraError(f"ingest rejected {doc_id}: {res.get('error_code')} {res.get('error')}")
        return res

    def status(self, collection: str, doc_id: str) -> str:
        """completed | errored | <in-progress state> | not_found"""
        r = self.http.get("/context/status", params={
            "database": self.database, "collection": collection, "ids": doc_id})
        st = ((self._json(r).get("data") or {}).get("statuses") or [{}])[0]
        if st.get("error_code") == "FILE_NOT_FOUND":
            return "not_found"
        return st.get("indexing_status") or "unknown"

    def wait_indexed(self, collection: str, doc_id: str, timeout: float = 600, every: float = 3) -> float:
        t0 = time.time()
        while time.time() - t0 < timeout:
            s = self.status(collection, doc_id)
            if s == "completed":
                return time.time() - t0
            if s == "errored":
                raise HydraError(f"{doc_id} indexing errored")
            time.sleep(every)
        raise HydraError(f"{doc_id} not indexed within {timeout}s")

    def query(self, collections: list[str], query: str, max_results: int = 8, graph: bool = True) -> dict:
        r = self.http.post("/query", json={
            "database": self.database, "collections": collections, "type": "knowledge", "query": query,
            "graph_context": graph, "max_results": max_results, "mode": "fast"})
        return self._json(r).get("data") or {}
