# HydraDB notes (spike, 2026-10-12)

Facts from `scripts/spike_hydra.py` against the live API (v2, base `https://api.hydradb.com`, header `API-Version: 2`). Adapter: `apps/api/whybrain/hydra.py`. Ingest: `scripts/ingest.py`.

## Naming
- `database` (formerly `tenant_id`) is the workspace. This account has one: `default-tenant`.
- `collection` (formerly `sub_tenant_id`, deprecated alias) partitions a database. Ours: `wb_demo` (accepted PEPs, also used for dev reads), `wb_dev_drafts` / `wb_demo_drafts` (drafts only, never the accepted collection). `wb_dev_claude` holds only the spike's two test docs.
- Document `id` is set through `document_metadata=[{"id": "pep-0386", "additional_metadata": {...}}]`. Unsupported keys (e.g. `title`) are a 400.

## Ingestion
- Upload is **asynchronous**: `POST /context/ingest` returns 202 "accepted and queued", not searchable.
- `.rst` is rejected (`E1002`, per-file `status: failed` inside a 202). Upload the same text as `.txt`, `text/plain`. The `.txt` content equals the `.rst`, so quotes verify against `data/peps/*.rst`.
- Poll `GET /context/status?database=&collection=&ids=<id>` until `indexing_status` is `completed` (or `errored`). An unknown id returns `errored` with `error_code: FILE_NOT_FOUND`.
- Indexing took about 96 s per document (2 docs: 192 s serially). Drafts therefore stay `pending` for 1-2 minutes.

## Retrieval and graph
- `POST /query` with `collections: [...]`, `type: "knowledge"`, `graph_context: true`. About 1.7 s. Returns `chunks` (verbatim `chunk_content`, `relevancy_score`, `source_title`), `sources`, `graph_context.query_paths[].triplets`, and `llm_prompt`.
- The graph is **entity triplets extracted from prose by an LLM**. It is real graph retrieval but not header traversal: there is no "follow Superseded-By" operation.
  - Useful: `pep 440 replaces pep 386`, `pep 386 superseded by pep 440`, each with `chunk_id` and `context`.
  - Noisy: `GET /context/relations` returned 70 relations for PEP 386, including `"'dev' replaced with '@'"` under `replaces`.
  - `GET /context/{id}/subgraph` returned 0 groups.
- Decision: triplets are a supporting signal only (surfaced in `tool_completed.summary`). `evidence_edges` come only from manifest headers (`origin: source_header`).

## Latencies (single calls)
list databases ~0.4-0.8 s, database status ~0.09 s, ingest accept ~0.2-0.5 s, status poll ~0.15 s, query ~1.7 s, relations ~0.1 s, subgraph ~0.2 s.
