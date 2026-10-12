# Why Brain: instructions for coding agents

Answers "Why did we decide that?" from a decision graph (public PEPs stand in for a company's decision log), shows what superseded a decision with cited evidence, reviews a new proposal against that evidence, and saves it as a clearly labeled draft. Built for the Company Brain Hackathon (HydraDB + Anthropic Sonnet). Demo story: explain why PEP 386 was replaced -> review one proposal against PEP 440's rationale -> save a labeled draft -> retrieve it again.

## Layout
```
apps/api/            Python/FastAPI: agent, retrieval, graph logic, HydraDB adapter, drafts (uv; pyproject.toml)
apps/web/            Next.js/TypeScript UI (own package.json + lockfile)
packages/contracts/  openapi.json, schemas/, generated src/api.d.ts, fixtures/  (generated; never hand-edit)
data/peps/           committed corpus snapshot + manifest.json
data/eval/           ground_truth.yaml (Josh), results.json (generated)
scripts/             Python: fetch_peps, export_contract, make_fixtures, ingest, run_checks, eval
docs/                parallel-workflow, CONTRACT_CHANGES, demo-script, web, design-reference
```
No root package.json, no shared lockfile.

## Owners and paths (no cross-edits)
- Claude Code: `apps/api/**`, `scripts/**`, `packages/contracts/**`, `data/peps/**`, root config, `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/**` except `docs/web.md`. Integration owner.
- Codex: `apps/web/**` (including its dependency and lock files) and `docs/web.md`. Needs anything else? Add a line under "Requests" in `docs/web.md`. Adds no dependencies to `packages/contracts`.
- Josh: `data/eval/ground_truth.yaml`, manifest approval, contents of `docs/demo-script.md`, `docs/design-reference/`.
- Until the scaffold PR merges, the cloud Claude session owns the scaffold and contract; local Claude owns `scripts/spike_hydra.py` only. See `docs/CONTRACT_CHANGES.md`.

## Contract rules
- Source of truth: `apps/api/whybrain/schemas.py`. Regenerate with `uv run --project apps/api python scripts/export_contract.py && uv run --project apps/api python scripts/make_fixtures.py && (cd packages/contracts && npm run types && npm run check)`.
- Change only in a dedicated `contract:` commit that regenerates everything and appends an entry to `docs/CONTRACT_CHANGES.md` (date, commit, what changed, how to adapt). Frontend reads that file whenever it pulls. Josh is not a relay.
- Frontend uses the generated types only; no hand-written duplicates. Graph UI draws only from `evidence_edges` and `inspected_doc_ids`; never infer relationships from prose.
- Dependency handoffs are immediate: pull a merged dependency as soon as it lands. Checkpoints (2:40, 3:00, 3:20, 3:40 PT) schedule integration merges, not handoffs.

## Product rules (do not weaken)
- Keep `source_status` verbatim. Supersession ("as of the corpus snapshot") and inferred conflicts are separate things. A Final document can still be superseded; a terminal PEP is a historical record, not automatically today's spec.
- Supersession comes from source headers, never from the model. A missing successor is an explicit gap (`target_in_corpus: false`).
- A proposal or draft is never authoritative: only `proposes_to_replace` (origin `proposal`); never create `replaces`/`superseded_by` from it; never change accepted statuses. UI copy: "Suggested replacement (not an accepted change)". Drafts carry label PROPOSAL.
- Authors are "recorded contacts", not current owners.
- Quote verification (`whybrain/quotes.py`) checks accuracy only. Whether a quote supports the conclusion is Josh's judgement.
- Modes: LIVE means HydraDB supplied evidence actually used in the response AND the model call completed. Failed or merely attempted calls do not qualify. LOCAL = committed snapshot + model; if the model fails return `model_unavailable`, never fall back silently. REPLAY = recorded playback, user-selected. The UI shows `provenance.mode_used`, never health config. Fixture/mock playback always shows a persistent "Mock data" badge, even if a fixture says LIVE.
- Drafts: `status: indexed` only after provider indexing completed AND a retrieval of that `draft_id` read from the real store (HydraDB, or the explicit local store in LOCAL mode), not the cached save response. Keep indexing completion and retrieval verification as separate stages. Same `draft_id` + same `content_hash` returns the existing record; different content returns 409 `draft_conflict`; no update operation (editing means a new `draft_id`). Disable Save while pending.
- No fabricated metrics, invented confidence percentages, or decorative gauges. Show real counts and real eval results only.

## Streaming
SSE over POST. Events carry `request_id` and strictly increasing `seq`: `request_started`, `tool_started`, `tool_completed`, then exactly one terminal event (`answer_completed` | `review_completed` | `error`), then the server closes. Close without a terminal event is `stream_interrupted` on the client. Cancel with `AbortController`; the server stops the agent when the client disconnects.

## Design tokens (starting values; Josh may revise from the screenshot in `docs/design-reference/`)
surface/sidebar `#FFFFFF`, workspace `#F6F7EF`, text `#20211F`, secondary `#686B64`, border `#DFE2D9`, evidence (supported) `#26776B`, conflict `#956218`. Quiet, spacious analytical workspace: thin neutral borders, rounded cards, minimal shadows, simple line icons, readable sans-serif, dark selected decision card. Always pair color with a text label.

## Secrets and config
`.env` (gitignored) holds `HYDRADB_API_KEY`, `ANTHROPIC_API_KEY`, backend only. `apps/web/.env.local` holds only `NEXT_PUBLIC_API_URL`. Never commit keys, never put them in the web bundle, never paste them in chat. Ports: API 8000 (integration) / 8001 (Claude lane); web 3000 / 3100 (Codex). HydraDB collections: `wb_dev_claude` (dev), `wb_demo` (demo); drafts in a separate collection from accepted decisions. Codex never touches HydraDB.

## Git
Small commits. Merge to main at stable points; the Claude lane merges at checkpoints. Do not rebase automatically during active edits. Run before merging: `uv run --project apps/api pytest` and `(cd packages/contracts && npm run check)`; web lane also lint and type-check.
