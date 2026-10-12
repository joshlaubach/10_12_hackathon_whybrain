"""Draft lifecycle with a fake HydraDB: no network, no real store."""
import hashlib
import json

import pytest
from fastapi.testclient import TestClient

from whybrain import agent, corpus, drafts, main
from whybrain import schemas as s

client = TestClient(main.app)
BODY = {"draft_id": "0b0e4b6e-5c7e-4a43-9d57-2f3b7a1c9e10", "title": "Sort dev after rc",
        "body_md": "# Proposal\n\nSort dev releases after rc.", "proposes_to_replace": ["pep-0440"]}


class FakeHydra:
    calls: list = []
    indexed = False      # provider finished indexing
    searchable = False   # retrieval returns the draft

    def ingest_text(self, collection, doc_id, text, metadata=None):
        FakeHydra.calls.append(("ingest", collection, doc_id, text))
        return {"id": doc_id}

    def status(self, collection, doc_id):
        return "completed" if FakeHydra.indexed else "graph_creation"

    def query(self, collections, query, max_results=8, graph=True):
        FakeHydra.calls.append(("query", tuple(collections)))
        if not FakeHydra.searchable:
            return {"chunks": []}
        return {"chunks": [{"source_title": f"{BODY['draft_id']}.txt", "chunk_content": "PROPOSAL"}]}


@pytest.fixture(autouse=True)
def setup(monkeypatch, tmp_path):
    FakeHydra.calls, FakeHydra.indexed, FakeHydra.searchable = [], False, False
    monkeypatch.setenv("DRAFTS_DIR", str(tmp_path))
    monkeypatch.setenv("HYDRADB_API_KEY", "x")
    monkeypatch.setenv("HYDRA_DRAFTS_COLLECTION", "wb_test_drafts")
    monkeypatch.setattr(drafts, "Hydra", FakeHydra)
    monkeypatch.setattr(drafts, "_worker", lambda draft_id: None)


def history_hash():
    h = hashlib.sha256()
    h.update((corpus.PEPS / "manifest.json").read_bytes())
    for d in sorted(corpus.BY_ID):
        h.update(corpus.text(d).encode())
    h.update(json.dumps(client.get("/api/decisions").json(), sort_keys=True).encode())
    return h.hexdigest()


def test_indexed_only_after_indexing_and_a_retrieval_from_the_store():
    before = history_hash()
    r = client.post("/api/drafts", json=BODY)
    assert r.status_code == 201
    rec = s.DraftRecord(**r.json())
    assert rec.status == "pending" and rec.label == "PROPOSAL"
    # provider still indexing: stays pending even though the save response is cached
    assert client.get(f"/api/drafts/{BODY['draft_id']}").json()["provider_indexing"] == "pending"
    # provider done but nothing retrievable yet: indexing and verification are separate stages
    FakeHydra.indexed = True
    g = client.get(f"/api/drafts/{BODY['draft_id']}").json()
    assert (g["status"], g["provider_indexing"], g["retrieval_verification"]) == ("pending", "completed", "pending")
    # retrievable: now indexed, verified via HydraDB
    FakeHydra.searchable = True
    g = s.DraftRecord(**client.get(f"/api/drafts/{BODY['draft_id']}").json())
    assert g.status == "indexed" and g.verified_via == "hydradb"
    assert history_hash() == before  # accepted history untouched


def test_drafts_go_only_to_the_drafts_collection():
    client.post("/api/drafts", json=BODY)
    ing = [c for c in FakeHydra.calls if c[0] == "ingest"]
    assert [c[1] for c in ing] == ["wb_test_drafts"] and agent.ACCEPTED_COLLECTION != "wb_test_drafts"
    assert "PROPOSAL" in ing[0][3] and "not an accepted decision" in ing[0][3]
    FakeHydra.indexed = FakeHydra.searchable = True
    client.get(f"/api/drafts/{BODY['draft_id']}")
    assert all(c[1] == ("wb_test_drafts",) for c in FakeHydra.calls if c[0] == "query")


def test_same_content_returns_existing_different_content_conflicts():
    first = client.post("/api/drafts", json=BODY)
    again = client.post("/api/drafts", json={**BODY, "title": BODY["title"] + " "})  # hash trims
    assert again.status_code == 200 and again.json() == first.json()
    assert len([c for c in FakeHydra.calls if c[0] == "ingest"]) == 1
    r = client.post("/api/drafts", json={**BODY, "body_md": BODY["body_md"] + " changed"})
    assert r.status_code == 409 and r.json()["code"] == "draft_conflict"
    assert client.get(f"/api/drafts/{BODY['draft_id']}").json()["body_md"] == BODY["body_md"]


def test_unknown_and_invalid_ids():
    assert client.get("/api/drafts/does-not-exist").status_code == 404
    assert client.post("/api/drafts", json={**BODY, "draft_id": "../../etc/passwd"}).status_code == 422


def test_provider_rejection_is_failed_not_pending(monkeypatch):
    def reject(self, *a, **k):
        raise drafts.HydraError("E1002")
    monkeypatch.setattr(FakeHydra, "ingest_text", reject)
    rec = s.DraftRecord(**client.post("/api/drafts", json=BODY).json())
    assert rec.status == "failed" and rec.provider_indexing == "failed" and rec.error


def test_local_mode_uses_the_explicit_local_store(monkeypatch):
    monkeypatch.delenv("HYDRADB_API_KEY")
    monkeypatch.setattr(drafts, "load_env", lambda: None)
    assert client.post("/api/drafts", json=BODY).status_code == 201
    g = s.DraftRecord(**client.get(f"/api/drafts/{BODY['draft_id']}").json())
    assert g.status == "indexed" and g.verified_via == "local_store"
