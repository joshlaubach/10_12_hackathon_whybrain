# Web lane notes (Codex-owned)

Codex owns this file and `apps/web/**`. Notes about the web app go here.

## Run the web app

From `apps/web`, run `npm ci`, then `npm run dev`. Open http://localhost:3100.
Node 20.9+ is required. The committed lockfile pins the web dependencies independently of the contract package.

Without an API URL configured, the default is **Mock playback**, with a persistent **Mock data** badge. The initial view uses the recorded PEP 386/440 answer. Recorded examples cover supersession, a missing successor, abstention, and a model error. Mock playback accepts those example questions and the example proposal only; arbitrary input gets a structured error directing the user to Connected API.

To connect the backend, set only `NEXT_PUBLIC_API_URL=http://localhost:8000` in `apps/web/.env.local` (8001 for the Claude lane), restart Next. A configured URL starts in **Connected API**, with no initial fixture answer. Mock playback requires an explicit selection. The API base comes only from NEXT_PUBLIC_API_URL; selecting Connected API without it shows a configuration error. **API replay** explicitly sends `mode_preference: REPLAY`; Connected API sends AUTO. API failures never fall back to fixtures. Keys remain in the backend and are never loaded by this web app.

## Design and contract

No design screenshot was present at implementation time. The workspace uses the supplied tokens, Avenir/Segoe UI sans-serif typography, a white navigation rail, a dark selected decision, and a pale workspace. On narrow screens navigation becomes a top row and panels stack. Controls have visible focus and text labels; there is no decorative animation.

Payload types come only from `@contracts/src/api` (a TypeScript alias to the generated declarations). Runtime validation uses the generated JSON Schemas. The SSE parser handles fragmented UTF-8 and CRLF, comments, multiline data, consistent request IDs, contiguous sequence numbers starting at zero (gaps are rejected under the pre-merge checklist), the expected terminal kind, and exactly one terminal event followed by closure. Early close and malformed frames are `stream_interrupted`. A result is displayed only once its stream closes successfully. AbortController handles cancellation, superseded requests, and timeouts.

The graph contains only `inspected_doc_ids` and typed `evidence_edges`. Source-header relationships, missing successors, inferred conflicts, and proposal suggestions are separate groups. Source statuses are verbatim. Evidence selections show citations or supporting evidence; uncited nodes fetch and cache `/api/decisions/{doc_id}` sections by transport, snapshot, and ID. Mock detail routes read the committed source snapshot, never a provider.

Proposal drafts retain their client-generated UUID for retry/idempotency. Editing a saved draft under the same UUID can return `draft_conflict`; **Save as new draft** allocates a new UUID. Saving polls the GET endpoint, with provider indexing and retrieval verification displayed separately. Saving is disabled while pending. **Check draft status** resumes a timed-out verification. An indexed response without completed indexing and verified retrieval is rejected.

Mock draft stages are explicitly simulated in web-server memory, labeled PROPOSAL and Mock data; they never upload anything and disappear when the server restarts. The save scenario selector covers successful and failed indexing. Evaluation stays **not run yet** until an actual result source is supplied; counts come from `/api/health` (the committed fixture in mock mode). Health configuration never sets the answer mode; the mode indicator uses the terminal response provenance and identifies recorded provenance during fixtures.

## Checks

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run build` from `apps/web`. Browser tests use Playwright Chromium; install the matching browser with `npm exec -- playwright install chromium` once. The browser gate supplies NEXT_PUBLIC_API_URL=http://localhost:8001 when unset. Stop any unconfigured dev server before running it; a reused server must have the same URL. Its connected-API cases intercept responses and do not invoke the model or upload drafts. Browser artifacts are ignored locally.

Verified on 2026-10-12: lint, type-check, production build, 17 unit tests, and 22 Chromium browser flows. Browser coverage includes citation and edge selection, missing successors, abstention, cancel/error handling, cached source sections, mock draft conflict/new-ID/failure handling, retained draft state across navigation, mobile overflow/navigation, and the connected-API/replay protocol using isolated intercepted responses. Desktop and mobile screenshots were visually inspected. The final gate ran against a production build after merging current main. All 47 backend tests also passed with isolated dependencies and no copied keys. Live provider calls have not been verified.

Dependency review (2026-10-12): the runtime dependencies installed without advisories. The full audit reports five high-severity entries in the development-only lint dependency chain (`eslint-config-next` → `fast-glob` → `micromatch` → `braces`). The reported braces issue concerns deeply nested glob patterns; lint scans this repo using fixed, trusted patterns, and the package is absent from the runtime dependency tree. The latest braces release is still 3.0.3 and is covered by the advisory; npm proposes downgrading Next's lint configuration across a major version. That forced downgrade is deferred to avoid incompatible lint rules. Recheck on 2026-10-13 or before deployment, whichever comes first.

Pull dependencies immediately with `git fetch origin` and `git merge origin/main`; read `docs/CONTRACT_CHANGES.md` after every update. Integration checkpoints remain 2:40, 3:00, 3:20, and 3:40 PT, then fixes only.

## Requests

Add one line per request for another owner (contract, backend, root config, docs). Claude reads this at each checkpoint, and sooner when something blocks you.

- Backend/integration: allow exact origin `http://localhost:3100` for API ports 8000 and 8001; allow GET, POST, OPTIONS and headers Content-Type/Accept. The UI makes direct cross-origin fetches, with no proxy or restrictive connect-src policy. Implement `GET /api/health -> HealthResponse`, `GET /api/decisions -> DecisionList`, `GET /api/decisions/{doc_id} -> DecisionDetail` (sections/quotes), `POST /api/ask` with `AskRequest -> StreamEvent SSE`, `POST /api/proposals/review` with `ProposalReviewRequest -> StreamEvent SSE`, `POST /api/drafts` with `DraftCreateRequest -> DraftRecord` (201 created, 200 existing, 409 ErrorBody/draft_conflict), `GET /api/drafts/{draft_id} -> DraftRecord`. All names refer to generated `packages/contracts/src/api.d.ts`. Close each SSE stream after exactly one terminal, preserve request_id, start seq at 0 and increment by 1. Errors before streaming return non-200 JSON ErrorBody. Indexed drafts must include provider_indexing=completed, retrieval_verification=verified, verified_via=hydradb|local_store. Do not report indexed before independent retrieval verification. Live provider calls remain unverified by the web lane.
- Evaluation owner: supply the real results source and its schema (e.g. a contract endpoint or the agreed results file shape). No evaluation payload exists in contract v1; the web view currently shows the required `not run yet` state and health counts.

Requested `data/eval/results.json` shape (for a real runner): `{ "schema_version": 1, "snapshot_id": "<corpus snapshot>", "generated_at": "<ISO timestamp>", "cases": [{ "id": "<case id>", "question": "<input>", "expected_doc_ids": ["<doc id>"], "actual_doc_ids": ["<doc id>"], "passed": true, "mode_used": "LIVE|LOCAL|REPLAY", "error": null }] }`. `error`, if present, should be the generated `ErrorBody`. Derive aggregates from cases; include no precomputed confidence values. The results view needs integration once the owner supplies this file/schema.


## Pre-merge checklist evidence (2026-10-12)

The final gate used a clean npm ci after merging origin/main (16021f5; backend baseline caf0ff9) into codex/ui, with the production web server at :3100 configured for localhost:8001. Baseline key names are unchanged from main and were explicitly allowed by Josh. Expected HTTP error diagnostics from error fixtures are separate from application console errors.

| Item | Pass/fail | Evidence |
| --- | --- | --- |
| 1. Scope/secrets | PASS | git diff --stat origin/main...HEAD: only apps/web and docs/web.md. Web secret grep: zero matches; full grep matches unchanged main baseline names only. c90c9e6 stat grep printed nothing. |
| 2. Bundle/config | PASS | Built .next grep for sk-ant, HYDRADB, ANTHROPIC: no output. Only public variable is NEXT_PUBLIC_API_URL. |
| 3. Clean install | PASS | Post-merge rm -rf node_modules + npm ci; lint, typecheck, build; 17 unit and 22 browser tests pass, none skipped. node_modules/.next ignored; lockfile tracked. |
| 4. Contract | PASS | npm --prefix packages/contracts run check exits 0 (web tsc on PATH; no contract edits/install). Generated payload aliases use @contracts/src/api. |
| 5. Every fixture | PASS | Browser tests “all stream and draft fixtures render without application console errors at 1440px/390px”: all 5 streams; decisions, decision_pep-0386, health; pending/indexed/indexed_local/failed/conflict. |
| 6. Protocol errors | PASS | Separate browser tests “protocol sequence gap”, “out of order”, “request ID changed”, “two terminals”, “missing terminal”: visible stream_interrupted and re-enabled controls. |
| 7. Abort | PASS | “Abort cancels the network fetch and clears progress and answer state”: requestfailed ERR_ABORTED, no progress/answer, controls enabled. |
| 8. Pre-stream errors | PASS | Separate model_unavailable, not_found and non-SSE browser cases show structured errors. |
| 9. Mode/badge | PASS | Every fixture state checks Mock data, including recorded LIVE. Health configuration mutation cannot change response mode; connected/replay test. |
| 10. History/conflicts | PASS | “source history, explicit gaps, and inferred conflicts are separate, labeled groups”; verbatim Final/Superseded; amber rgb(149,98,24) with inferred-conflict text. |
| 11. Graph inputs | PASS | Removing fixture edges leaves zero edges; prose inventing PEP 999 creates no node. PEP 749 is an explicit gap, absent from graph nodes. |
| 12. Selections | PASS | Citation and edge browser inspection; fixture node quote selection; uncited node selectable sections test. |
| 13. Abstention | PASS | Both fixture sizes assert exact “I can't answer that from the record” and zero citation buttons. |
| 14. Proposal language | PASS | Both fixture sizes assert exact suggested-replacement copy, PROPOSAL label, Recorded contacts. |
| 15. Draft flow | PASS | Fixture suite covers 201/200, pending, 409, new UUID, HydraDB/local store labels. Separate pending-POST browser test; idempotency/conflict unit tests. |
| 16. Real numbers | PASS | Component numeral search reviewed: icon sizes, timeouts, indexes and PEP IDs; counts derive from payloads. Evaluation test: not run yet; no results.json. |
| 17. API readiness | PASS | “configured API starts connected, uses only configured URL, and mock needs explicit selection”: localhost:8001 requests from :3100, no silent fallback. Base only from public API URL; exact CORS origin/methods/headers in Requests. |
| 18. Cache | PASS | “uncited graph nodes load source sections once and reuse the detail cache”: one HTTP read across selections and a fresh stream/component. |
| 19. Accessibility | PASS | Keyboard reaches citations, nodes, edges, Save with reduced motion. Every screenshot state checks rendered text contrast >=4.5:1. Amber/teal pair with labels. |
| 20. Layout/screenshots | PASS | 20 PNGs under apps/web/test-results/checklist-all-stream-and-d-*: both widths for answer+graph, gap, abstention, stream error, review, pending/indexed/indexed_local/conflict/failed. Overflow checked at each capture; representative full-size views inspected. |
| 21. Docs | PASS | Run steps, port 3100, mock/live rules, seven endpoint shapes, exact CORS details and requested results.json shape above. |

All 47 updated backend tests passed with isolated dependencies and no copied keys: PYTHONPATH=$PWD/apps/api uv run --frozen --project apps/api pytest apps/api -p no:cacheprovider (UV_PROJECT_ENVIRONMENT outside repo). Data-only SSE dispatch has a dedicated unit test and the connected-API browser test. Provider calls remain unverified; tests do not call HydraDB or the model. Runtime audit has no advisories; the documented lint-only audit finding remains deferred.
