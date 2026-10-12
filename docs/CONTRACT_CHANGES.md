# Contract changes

Newest first. Codex reads this file whenever it pulls. Format: date, commit, what changed, how to adapt. Contract changes happen only in dedicated `contract:` commits that regenerate schema, types and fixtures.

## Ownership and handoff

- Until the scaffold PR merges to `main`, the cloud Claude session owns the initial scaffold and contract (AGENTS.md, CLAUDE.md, root config, `apps/api/pyproject.toml`, `apps/api/whybrain/**`, `scripts/export_contract.py`, `scripts/make_fixtures.py`, `scripts/fetch_peps.py`, `data/peps/**`, `packages/contracts/**`, docs skeletons). Local Claude owns only `scripts/spike_hydra.py` until then.
- **Ownership transfers to local Claude when the scaffold PR merges.** Scaffold PR: see "Scaffold PR" below. A commit cannot contain its own hash, so the resolved merge commit is recorded afterwards in the first handoff commit on `main` (local Claude's first commit, or the cloud session's if it is quicker): replace the line "Merge commit: pending" below.
- After transfer only local Claude changes the contract, in `contract:` commits. The cloud session stops editing `apps/api`, `scripts`, `packages/contracts` and `data/peps`; it keeps `docs/devpost.md` and README placeholders on request.

Scaffold PR: https://github.com/joshlaubach/10_12_hackathon_whybrain/pull/2
Merge commit: d4704a422d0eaceb14e69c3cf3416e0a3433fad3 (merged 2026-10-12 13:35 PT)
Ownership: transferred to local Claude as of that merge. The cloud session no longer edits apps/api, scripts, packages/contracts or data/peps.

## 2026-10-12: contract v1 (scaffold)

Initial contract. Everything is new; Codex adopts it as the starting point.

- Endpoints: `GET /api/health`, `GET /api/decisions`, `GET /api/decisions/{doc_id}`, `POST /api/ask` (SSE), `POST /api/proposals/review` (SSE), `POST /api/drafts`, `GET /api/drafts/{draft_id}`.
- Stream events: `request_started`, `tool_started`, `tool_completed`, terminal `answer_completed` | `review_completed` | `error`. `seq` strictly increasing from 0; one terminal event; the client treats a close without one as `stream_interrupted`.
- Terminal payloads carry `inspected_doc_ids` and typed `evidence_edges` (source, target, relation, origin, `target_in_corpus`, `supporting_evidence`). Draw the graph only from these.
- Node selection: citation `quote` in the current response, otherwise a `sections[]` entry from `GET /api/decisions/{doc_id}` (`DecisionDetail`). Edge selection: that edge's `supporting_evidence`.
- `origin` is `source_header | proposal | inferred`. `source_doc_id` may be a doc id, `proposal`, or `draft:<draft_id>`.
- Findings use `may_contradict | may_repeat | suggests_replacing`. UI copy for the last: "Suggested replacement (not an accepted change)".
- `provenance.mode_used` is the answer's mode. LIVE requires HydraDB evidence used in the response and a completed model call. Fixtures are `fixture: true`; show "Mock data" for any fixture playback even if a fixture says LIVE (the 386->440, unsupported and proposal fixtures do).
- Drafts: `status` pending | indexed | failed, with separate `provider_indexing` and `retrieval_verification`; `indexed` requires verified retrieval from the store (`verified_via`: `hydradb` or `local_store`). `content_hash` makes `POST /api/drafts` idempotent; different content under the same `draft_id` is 409 `draft_conflict`. No update operation: "Save as new draft" uses a new `draft_id`. Disable Save while a save is pending.
- Adapt: run `(cd packages/contracts && npm run check)`; import types from `packages/contracts/src/api.d.ts`; mock mode replays `packages/contracts/fixtures/stream_*.json`.
