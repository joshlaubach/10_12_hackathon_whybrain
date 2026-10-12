# Running Claude Code and Codex side by side

One repo, two worktrees, two branches, disjoint paths. `AGENTS.md` is the single source of instructions (Codex reads it natively; `CLAUDE.md` is `@AGENTS.md`).

## Setup (once, on your machine)

```bash
git clone https://github.com/joshlaubach/10_12_hackathon_whybrain.git && cd 10_12_hackathon_whybrain
git fetch origin claude/hopeful-einstein-0646rw          # scaffold branch, usable before the PR merges
git worktree add ../wb-claude -b claude/backend origin/claude/hopeful-einstein-0646rw
git worktree add ../wb-codex  -b codex/ui       origin/claude/hopeful-einstein-0646rw
# after the scaffold PR merges to main, in each worktree:
git fetch origin && git merge origin/main
```

- Backend `.env` only in `../wb-claude`: `cp .env.example .env`, fill `HYDRADB_API_KEY` and `ANTHROPIC_API_KEY`. Do not put keys in `../wb-codex`.
- `../wb-claude`: API on 8001 (`uv run --project apps/api uvicorn whybrain.main:app --port 8001`); integration/demo API on 8000 from `main`. `../wb-codex`: web on 3100 with `apps/web/.env.local` = `NEXT_PUBLIC_API_URL=http://localhost:8000` (or mock mode).
- HydraDB collections: `wb_dev_claude` (dev), `wb_demo` (demo). Codex never calls HydraDB.
- Codex CLI: workspace-write sandbox, approvals on request (check `codex --help` for current flag names).

## Handoffs and checkpoints

- A dependency is pulled the moment it is available: Codex adopts `packages/contracts` from the scaffold branch as soon as it is pushed, then merges `main` after the PR merges. Checkpoints are not handoff gates.
- Integration checkpoints (PT): 2:40 first real answer, 3:00 evidence chain and abstention, 3:20 proposal review, 3:40 draft save and retrieve, then freeze (fixes only). Local Claude merges to `main` at each.
- Contract changes are announced in `docs/CONTRACT_CHANGES.md`. Codex reads it on every pull. Codex requests go under "Requests" in `docs/web.md`.
- Ownership transfer: when the scaffold PR merges, ownership of the scaffold and contract passes from the cloud Claude session to local Claude. The resolved merge hash is recorded afterwards (see `docs/CONTRACT_CHANGES.md`).

## Kickoff prompt: local Claude Code (`../wb-claude`)

```
Read AGENTS.md and docs/CONTRACT_CHANGES.md. Until the scaffold PR merges to main, do not edit AGENTS.md, CLAUDE.md, root config, apps/api/whybrain/**, apps/api/pyproject.toml, scripts/export_contract.py, scripts/make_fixtures.py, scripts/fetch_peps.py, data/peps/** or packages/contracts/**; the cloud Claude session owns them.

Job 1 (hard stop 2:00 PM PT): scripts/spike_hydra.py. Read the official HydraDB docs/quickstart yourself (ingestion is asynchronous: upload is not searchable). Ingest one PEP from data/peps, wait for indexing, retrieve it, inspect the returned evidence, and test the graph operation the demo needs. Report the result and a scope decision (e.g. HydraDB retrieval plus our own header graph, stated honestly).

When the scaffold PR merges you own apps/api/**, scripts/**, packages/contracts/**, data/peps/**, root config and docs (except docs/web.md and the contents of docs/demo-script.md) and you are integration owner. First commit after the merge: record the resolved merge hash in docs/CONTRACT_CHANGES.md.

Then, in order: (1) real POST /api/ask on 386/440: HydraDB retrieval, deterministic supersession from headers, verified citations, typed evidence_edges and inspected_doc_ids, provenance. (2) missing-successor gap and abstention based on evidence support, not a score. (3) one bounded proposal review (POST /api/proposals/review). (4) draft save/retrieve: separate collection; track provider indexing and retrieval verification separately; report indexed only after reading the draft back from HydraDB (not the cached save response); same draft_id + same content_hash returns the existing record; different content is 409.

Rules: LIVE only when HydraDB supplied evidence used in the response and the model call completed; failed calls never qualify. Supersession never depends on the model. A draft never changes accepted history. Keys stay in the backend .env. Agent: max 6 tool calls, per-call timeout, cited doc_id must be in the retrieved set, quote must be a whitespace-normalised substring of the source. Contract changes only in `contract:` commits logged in docs/CONTRACT_CHANGES.md. Merge to main at 2:40, 3:00, 3:20, 3:40 PT; freeze 3:40.
```

## Kickoff prompt: Codex (`../wb-codex`)

```
Fetch origin/claude/hopeful-einstein-0646rw now and adopt packages/contracts (generated types, fixtures) immediately; after the scaffold PR merges, merge origin/main. Read AGENTS.md, docs/CONTRACT_CHANGES.md and docs/design-reference/ (Josh adds the screenshot there).

You own apps/web/** (including its dependency and lock files) and docs/web.md only. Anything else you need: add a line under "Requests" in docs/web.md.

Build the Next.js workspace: sidebar (Decisions, Ask Why, Review Proposal, Evaluation); top area (prominent question input, mode indicator, snapshot date); compact decision cards with real source metadata (dark selected card); evidence area (answer, clickable citations, small relationship graph); proposal area (findings, editable draft, Save draft with pending/indexed/failed state). Tokens: surface #FFFFFF, workspace #F6F7EF, text #20211F, secondary #686B64, border #DFE2D9, evidence #26776B, conflict #956218; quiet and spacious, thin borders, rounded cards, minimal shadows, simple line icons. Pair color with text labels. Do not reproduce the screenshot's CRM content.

Start with a mock mode (Next route handlers replaying packages/contracts/fixtures/stream_*.json with delays) and always show a persistent "Mock data" badge during any fixture playback, even when a fixture contains LIVE. Use the generated types only. Draw the graph only from evidence_edges and inspected_doc_ids; first view is PEP 386 -> superseded by -> PEP 440, static. A target_in_corpus:false edge renders as an explicit gap. Node selection shows the matching citation quote or the DecisionDetail section (GET /api/decisions/{doc_id}, cached); edge selection shows its supporting_evidence.

SSE client: fetch + ReadableStream, request_id, seq ordering, exactly one terminal event, close without one = stream_interrupted, AbortController cancel. Show source_status verbatim; show supersession, missing successors and inferred conflicts (amber, text label) separately. Findings wording for suggests_replacing: "Suggested replacement (not an accepted change)". Drafts are labeled PROPOSAL. Show provenance.mode_used, not health config. Disable Save while a save is pending; "Save as new draft" uses a new draft_id; 409 draft_conflict shows a clear message. Authors are "recorded contacts". Evaluation view shows only real results (empty state "not run yet"). No fabricated metrics, no decorative gauges.

API URL in NEXT_PUBLIC_API_URL; never handle keys. Pull a dependency the moment it lands; checkpoints (2:40, 3:00, 3:20, 3:40 PT) are integration merges, not gates. Animation comes later and only from real tool events.
```
