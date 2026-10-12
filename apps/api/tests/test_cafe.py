"""Maple Street Café (fictional sample) corpus, and the CORPUS switch. PEP behaviour is the default."""
import json
import subprocess
import sys
from pathlib import Path

from whybrain.quotes import quote_in_source

ROOT = Path(__file__).resolve().parents[3]
CAFE = ROOT / "data" / "cafe"
MAN = json.loads((CAFE / "manifest.json").read_text())
BY_ID = {d["doc_id"]: d for d in MAN["docs"]}


def in_cafe(code: str) -> str:
    """Run `code` in a fresh interpreter with CORPUS=cafe (the corpus is chosen at import)."""
    r = subprocess.run([sys.executable, "-c", code], cwd=ROOT / "apps" / "api", capture_output=True, text=True,
                       env={"CORPUS": "cafe", "PATH": "/usr/bin:/bin", "PYTHONPATH": "."})
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def test_cafe_manifest_is_consistent():
    assert sorted(BY_ID) == ["dr-002", "dr-005", "dr-007", "dr-009", "dr-011", "dr-014", "dr-016", "dr-018", "dr-020"]
    assert MAN["snapshot_id"].startswith("cafe-") and MAN["fictional"] is True
    for d in MAN["docs"]:
        assert (CAFE / d["file"]).exists() and d["file"].endswith(".txt")
        assert d["source_url"].endswith(f"/data/cafe/{d['doc_id']}.txt") and "github.com" in d["source_url"]
        head = (CAFE / d["file"]).read_text().split("\n\n", 1)[0]
        for rel, key in (("Replaces", "replaces"), ("Superseded-By", "superseded_by")):
            line = next((x for x in head.splitlines() if x.startswith(rel + ":")), None)
            want = [t.upper() for t in d[key]]
            assert (line.split(":", 1)[1].replace(" ", "").split(",") if line else []) == want, (d["doc_id"], rel)
        for t in d["replaces"]:   # edges are consistent in both directions where both docs exist
            assert d["doc_id"] in BY_ID[t]["superseded_by"]
        for t in d["superseded_by"]:
            assert t not in BY_ID or d["doc_id"] in BY_ID[t]["replaces"]


def test_dr021_is_the_only_gap_and_not_in_corpus():
    assert MAN["missing_successors"] == [{"doc_id": "dr-005", "missing_successor": "dr-021"}]
    assert "dr-021" not in BY_ID and not (CAFE / "dr-021.txt").exists()
    assert MAN["excluded_for_gap_demo"] == ["dr-021"]


def test_accepted_yet_superseded_and_other_statuses():
    assert BY_ID["dr-009"]["source_status"] == "Accepted" and BY_ID["dr-009"]["superseded_by"] == ["dr-018"]
    assert BY_ID["dr-007"]["source_status"] == "Withdrawn" and not BY_ID["dr-007"]["replaces"]
    assert BY_ID["dr-002"]["source_status"] == "Superseded"
    text016 = (CAFE / "dr-016.txt").read_text()
    assert "DR-021" not in text016 and "Friday" not in text016.split("\n\n", 1)[1]


def test_loyalty_record_names_no_current_owner():
    body = (CAFE / "dr-011.txt").read_text().split("\n\n", 1)[1].lower()
    assert "runs" not in body and "owner" not in body and "manager" not in body


def test_quote_verification_and_ids_for_dr():
    out = in_cafe(
        "import json;from whybrain import corpus, agent;"
        "from whybrain.quotes import quote_in_source as q;"
        "why='Turning away a regular customer cost more than the refund, and the receipt rule was the thing "
        "staff argued about most.';"
        "print(json.dumps([q(why, corpus.text('dr-014')), q('invented', corpus.text('dr-014')),"
        "corpus.mentioned('why was DR-002 replaced, and dr 14?'), corpus.display('dr-014'),"
        "agent._doc_from_title('dr-014.txt'), corpus.locate('dr-014', why), corpus.source_url('dr-021'),"
        "[e[:2] for e in corpus.header_edges('dr-005')], agent.ACCEPTED_COLLECTION]))")
    ok, bad, ment, disp, title, loc, url, edges, coll = json.loads(out)
    assert ok is True and bad is False
    assert ment == ["dr-002", "dr-014"] and disp == "DR-014" and title == "dr-014" and loc == "Why"
    assert url.endswith("/data/cafe/dr-021.txt") and coll == "wb_cafe"
    assert edges == [["superseded_by", "dr-016"], ["superseded_by", "dr-021"]]


def test_default_corpus_is_peps_and_unchanged():
    from whybrain import agent, corpus
    assert corpus.CFG["name"] == "peps" and corpus.SNAP == "peps-c977468c8532"
    assert corpus.display("pep-0386") == "PEP 386" and corpus.source_url("pep-0386") == "https://peps.python.org/pep-0386/"
    assert corpus.mentioned("Why was PEP 386 replaced? and pep440") == ["pep-0386", "pep-0440"]
    assert agent.ACCEPTED_COLLECTION == "wb_demo" and "Python Enhancement Proposals" in agent.SYSTEM


def test_cafe_quote_in_cafe_source_only():
    why = "Turning away a regular customer cost more than the refund"
    assert quote_in_source(why, (CAFE / "dr-014.txt").read_text())
    assert not quote_in_source(why, (CAFE / "dr-002.txt").read_text())
