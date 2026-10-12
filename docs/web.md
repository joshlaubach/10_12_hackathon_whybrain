# Web lane notes (Codex-owned)

Codex owns this file and `apps/web/**`. Notes about the web app go here.

## Run the web app

From `apps/web`, run `npm ci`, then `npm run dev`. Open http://localhost:3100.
Node 20.9+ is required. The committed lockfile pins the web dependencies independently of the contract package.

Without an API URL configured, the default is **Mock playback**, with a persistent **Mock data** badge. The initial view uses the recorded PEP 386/440 answer. Recorded examples cover supersession, a missing successor, abstention, and a model error. Mock playback accepts those example questions and the example proposal only; arbitrary input gets a structured error directing the user to Connected API.

To connect the backend, set only `NEXT_PUBLIC_API_URL=http://localhost:8000` in `apps/web/.env.local` (8001 for the Claude lane), restart Next. A configured URL starts in **Connected API**, with no initial fixture answer. Mock playback requires an explicit selection. The API base comes only from NEXT_PUBLIC_API_URL; selecting Connected API without it shows a configuration error. **API replay** explicitly sends `mode_preference: REPLAY`; Connected API sends AUTO. API failures never fall back to fixtures. Keys remain in the backend and are never loaded by this web app.

## Separate café workspace (draft branch; do not merge before 4:30 PT)

Leave the PEP demo checkout and server on :3100 → :8000 running unchanged. In a separate `codex/cafe-ui` worktree, install the existing lockfile with `npm ci` from `apps/web`, then run:

```sh
NEXT_PUBLIC_API_URL=http://localhost:8002 npx next dev --port 3000
```

Open http://localhost:3000. The café API must already be running separately on :8002 with `CORPUS=cafe`; the web app does not launch or reconfigure it. CORS permits http://localhost:3000 and http://localhost:3100. The command supplies the public API URL for this process without editing either setup's environment files. Restart Next after changing the URL; production builds also need the URL at build time.

Corpus detection uses a `cafe-` health snapshot or `dr-` document IDs. The sidebar identifies Maple Street Café and **Fictional sample: Maple Street Café** stays beside the snapshot information in every view. The API does not provide a snapshot date, so this corpus displays **Date not provided by API** rather than inventing one. Titles, source URLs, counts, and verbatim statuses come from responses. Accepted DR-009 remains Accepted while its header relationship separately shows Superseded by DR-018; the same separation applies to Final PEP 333.

Connected café questions and both proposal chips fill the relevant input only; submit explicitly to run a model request. PEP examples retain their existing text and behavior. Mock playback is intentionally PEP-only, always labeled Mock data. Café test responses live exclusively in `apps/web/tests/cafe-responses.ts`; they are not playback fixtures or shipped app data. The ordinary browser tests intercept the API and never create live drafts. Café mode hides API replay and shows **Replay recordings are unavailable for this corpus.** The note deliberately avoids PEP text on café screens. Café links say **source file** while preserving GitHub URLs supplied by the API. Answers, quotes, finding relations, explanations and draft prose are rendered unchanged; formatting applies only to IDs in UI-owned labels. Unrelated source-header edges returned by retrieval remain in the graph. The PEP-specific opt-in live smoke/browser scripts remain unchanged; live draft creation is still paused.

Verified on `codex/cafe-ui`: clean `npm ci`, lint, type-check, production build, 20 unit tests, 30 intercepted/fixture Chromium tests, generated contract check, and 56 backend regression tests pass after pulling main through `fce3581` (contract changelog unchanged). Café answer, gap, Accepted/superseded, abstention and proposal screenshots were captured at 1440/390; desktop gap and mobile review were inspected. Browser cases assert no PEP/Python UI copy or input values after café loading, no café copy in the PEP path, response-supplied links/statuses, and no requests from café example chips. The browser gate used an isolated production server on :3103; the PEP demo server was left running unchanged. The original café pass used intercepted responses; a separate real café pass is documented below. No live drafts were created.

## Read-only café browser check

With the café API already running on http://localhost:8002 and port 3000 free, run `npm run test:cafe-live` from `apps/web`. Its dedicated config starts and stops a separate Next dev process on :3000 with NEXT_PUBLIC_API_URL set to :8002; it refuses to reuse an existing server. It does not start the API, change collections, read keys, or touch the PEP demo server. Keep the café PR draft and unmerged until Josh authorizes it after 4:30 PT.

The opt-in harness uses real, un-intercepted health/list/ask/review responses. Draft endpoints are blocked, no Save control is clicked, and zero draft attempts are asserted. It verifies the refund's DR-014 citation and two-way header edges; weekday hours plus the DR-021 gap without a node; loyalty-owner abstention and Priya Nair under Recorded contacts; DR-009's Accepted status separately from its superseded-by-DR-018 relationship; both example proposals with exactly the finding labels returned by that run. Graph node IDs and every edge are compared to the response, so additional unrelated returned edges are displayed. Answer and draft text are compared verbatim, never normalized. Captures cover 1440/390 for all six responses; payloads/screenshots are saved under ignored `apps/web/test-results/cafe-live/`.

Live café check passed on 2026-10-12 ~3:41 PT: `npm run test:cafe-live` completed in 36.8 seconds. All six terminal responses used LIVE provenance, fixture=false, and no Mock data appeared. There were no application console errors or draft attempts. Desktop hours/gap and mobile revert-review captures were inspected. Lint, type-check, production build, 20 unit tests, 30 fixture/intercepted browser tests and the unchanged generated contract check also pass. Brand rename PR17 and polish PR19 are already merged; the PEP server on :3100 stayed unchanged.

| Real café flow | Result | Evidence |
| --- | --- | --- |
| Health/list and replay | PASS | Snapshot cafe-5ed395beac31; 9 documents, 7 source-header links, 1 missing successor; API replay hidden, explanatory note present, requests send AUTO. |
| Refund | PASS | 4 citations including DR-014; DR-002 source status Superseded; DR-014 replaces DR-002 and DR-002 superseded_by DR-014; GitHub source-file link preserved. |
| Opening hours | PASS | 3 citations; DR-005 → DR-016; DR-021 explicit gap, no node. All 5 returned edges drawn, including DR-009/DR-018 header edges. |
| Loyalty owner | PASS | Abstained, zero citations; Priya Nair displayed under Recorded contacts from DR-011. |
| Paper schedules | PASS | 6 citations; DR-009 source status Accepted remains verbatim while the separate header edge says Superseded by DR-018. |
| Revert proposal | PASS | Model returned suggests_replacing and may_repeat, displayed without substituting may_contradict. All 3 returned edges and unchanged draft text rendered. |
| Benign sign proposal | PASS | Model returned may_repeat; both returned historical edges displayed. Finding labels and draft text match the response. |
| Draft indexing | NOT ATTEMPTED | Café collections are stalled; no Save clicks or draft requests. Draft endpoints are blocked in this harness. |

These real responses differed from the isolated café vectors in citation counts, edge direction/count, additional inspected documents, and review finding relations. No UI normalization or relationship filtering was introduced. Café draft indexing remains unverified at Josh's direction; the web lane did not change provider state.

## Design and contract

The workspace follows docs/design-reference/reference.png and the supplied tokens: Inter via next/font, a white navigation rail, a dark selected decision, and a pale workspace. Mock data uses a neutral dark outline. The header stat strip derives document count and snapshot id from /api/decisions, and source-header links/missing successors from /api/health. Counts remain response-derived; no gauges or fabricated metrics. Decision icon chips appear only for real recorded contacts, replaces, resolution and discussion fields. On narrow screens navigation becomes a top row and panels stack. Controls have visible focus and text labels; there is no decorative animation.

Payload types come only from `@contracts/src/api` (a TypeScript alias to the generated declarations). Runtime validation uses the generated JSON Schemas. The SSE parser handles fragmented UTF-8 and CRLF, comments, multiline data, consistent request IDs, contiguous sequence numbers starting at zero (gaps are rejected under the pre-merge checklist), the expected terminal kind, and exactly one terminal event followed by closure. Early close and malformed frames are `stream_interrupted`. A result is displayed only once its stream closes successfully. AbortController handles cancellation, superseded requests, and timeouts.

The graph contains only `inspected_doc_ids` and typed `evidence_edges`. Source-header relationships, missing successors, inferred conflicts, and proposal suggestions are separate groups. Source statuses are verbatim. Evidence selections show citations or supporting evidence; uncited nodes fetch and cache `/api/decisions/{doc_id}` sections by transport, snapshot, and ID. Mock detail routes read the committed source snapshot, never a provider.

Proposal drafts retain their client-generated UUID for retry/idempotency. Editing a saved draft under the same UUID can return `draft_conflict`; **Save as new draft** allocates a new UUID. Saving polls the GET endpoint, with provider indexing and retrieval verification displayed separately. Saving is disabled while pending. **Check draft status** resumes a timed-out verification. An indexed response without completed indexing and verified retrieval is rejected.

Mock draft stages are explicitly simulated in web-server memory, labeled PROPOSAL and Mock data; they never upload anything and disappear when the server restarts. The save scenario selector covers successful and failed indexing. Evaluation stays **not run yet** until an actual result source is supplied; counts come from `/api/health` (the committed fixture in mock mode). Health configuration never sets the answer mode; the mode indicator uses the terminal response provenance and identifies recorded provenance during fixtures.

## Checks

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run build` from `apps/web`. Browser tests use Playwright Chromium; install the matching browser with `npm exec -- playwright install chromium` once. The browser gate supplies NEXT_PUBLIC_API_URL=http://localhost:8001 when unset. Stop any unconfigured dev server before running it; a reused server must have the same URL. Its connected-API cases intercept responses and do not invoke the model or upload drafts. Browser artifacts are ignored locally.

Verified on 2026-10-12: lint, type-check, production build, 17 unit tests, and 22 Chromium browser flows. Browser coverage includes citation and edge selection, missing successors, abstention, cancel/error handling, cached source sections, mock draft conflict/new-ID/failure handling, retained draft state across navigation, mobile overflow/navigation, and the connected-API/replay protocol using isolated intercepted responses. Desktop and mobile screenshots were visually inspected. The final gate ran against a production build after merging current main. All 47 backend tests also passed with isolated dependencies and no copied keys. That merge gate used fixtures; the real provider results are recorded in the live checkpoint below.

Dependency review (2026-10-12): the runtime dependencies installed without advisories. The full audit reports five high-severity entries in the development-only lint dependency chain (`eslint-config-next` → `fast-glob` → `micromatch` → `braces`). The reported braces issue concerns deeply nested glob patterns; lint scans this repo using fixed, trusted patterns, and the package is absent from the runtime dependency tree. The latest braces release is still 3.0.3 and is covered by the advisory; npm proposes downgrading Next's lint configuration across a major version. That forced downgrade is deferred to avoid incompatible lint rules. Recheck on 2026-10-13 or before deployment, whichever comes first.

Pull dependencies immediately with `git fetch origin` and `git merge origin/main`; read `docs/CONTRACT_CHANGES.md` after every update. Integration checkpoints remain 2:40, 3:00, 3:20, and 3:40 PT, then fixes only.

## Live integration checkpoint

The checkout pulled `origin/main` through `d243d10` and read the contract changelog on every pull. That dependency adds an opt-in café corpus; port 8000 still serves the original PEP snapshot, and its draft collection default is unchanged. A production build on `http://localhost:3100` uses `NEXT_PUBLIC_API_URL=http://localhost:8000`, with Connected API selected and mock off. `npm run smoke:live -- http://localhost:8000` exercises generated-schema validation, the real SSE parser, three questions and proposal review. It performs no live draft writes. `npm run test:live` uses un-intercepted Chromium requests and captures 1440/390 screenshots. These are opt-in provider checks; the ordinary browser suite remains isolated.

Confirmed from real responses: health reports 24 documents, 17 source-header edges, 2 missing successors, snapshot `peps-c977468c8532`; the 386 answer is LIVE from provenance with no Mock data, and its graph contains the two returned evidence edges; 563 exposes 749 as a gap rather than a node; the unsupported question abstains without citations; proposal review returns three findings and recorded contacts; draft POST returns 201/pending. Josh accepted the live integration as **passed except draft indexing** on 2026-10-12 ~3:06 PT. The 386 assertion now requires at least three citations, a PEP 386 Header quote (citations or source-header supporting_evidence) and a PEP 440 citation. The UI renders the returned citation count. Live draft creation is stopped until Josh explicitly authorizes it; provider indexing remains under investigation.

Artifacts: `apps/web/test-results/live/smoke.json` and `apps/web/test-results/live-browser/` (ignored). Live smoke and browser suites no longer create or poll saved drafts. The first browser run reached pending and exercised every preceding flow; its 60-second indexed assertion failed. The repeat exposed the five-citation response. The citation requirement was revised by Josh; the draft indexing failure remains recorded and is excluded from new live runs at his explicit request. Fixture draft tests remain enabled.

Fixture differences from real responses: the 386 fixture has six citations, while live responses returned four then five; the 563 fixture has two citations versus four live; live abstention inspected PEPs 426/517/508/566 instead of fixture PEPs 440/621; live review produced three findings and four edges across PEPs 386/440 versus two findings/two edges in the fixture. Tool traces have different event counts and data-only SSE framing. The UI rendered these response-driven counts and graph inputs without assuming fixture sizes. The long indexing delay and eventual backend timeout were absent from the success fixtures.

| Live check | Result | Evidence |
| --- | --- | --- |
| Corpus and cross-origin requests | PASS | Real health/decisions: 24 documents, 17 source-header edges, 2 missing successors; browser from :3100 to :8000. |
| 386 provenance / no mock / graph | PASS | Smoke + first browser: LIVE, fixture=false, 4 citations, 2 source-header edges; no Mock data. |
| 386 source evidence | PASS | Revised smoke passes: at least 3 citations, PEP 386 source-header quote and PEP 440 citation. Model citation counts are preserved. |
| 563 gap | PASS | Live edge target pep-0749 has target_in_corpus=false; browser explicit gap, no 749 node. |
| Abstention | PASS | Live abstained=true, zero citations; browser exact abstention heading. |
| Proposal review | PASS | LIVE, 3 findings, 4 edges; browser draft and Recorded contacts visible. |
| Draft indexed / verified_via | DEFERRED | 201/pending then backend failed after 600 seconds; error recorded in smoke.json, verified_via=null. |
| Existing checks and recovery | PASS | Lint, type-check, build, contract check, 17 unit / 24 fixture browser / 1 real API browser / 54 backend tests pass after the café dependency and polish; the browser suite now includes the timeout/resume regression. |

## Polish checkpoint (2026-10-12 ~3:15 PT)

Completed: neutral dark-outline Mock data badge; self-hosted Inter using next/font/google; a response-driven stat strip (list documents/snapshot id, health source-header links/missing successors); icon chips from recorded contacts, replaces, resolution and discussion fields only. The evidence layout is preserved. No status board or optional chart was added in this polish pass.

The dedicated polish browser test changes response counts and snapshot id and verifies those exact values in the strip, checks absent fields produce no chips, and checks Inter plus the neutral badge. The full fixture suite checks every state at 1440/390, text contrast and viewport overflow. The real API suite passed after the assertion correction, with 386, 563 gap, abstention and proposal review; no draft saves are performed. PR16 had already merged; the corrected live checks and pause on automated draft writes are merged in PR18.

## Requests

Add one line per request for another owner (contract, backend, root config, docs). Claude reads this at each checkpoint, and sooner when something blocks you.

- Café backend follow-up (planned, nonblocking): normalize document-ID spelling in generated prose upstream and filter unrelated retrieved header edges if desired. The real opening-hours response returned DR-009/DR-018 edges as well as the requested hours/gap edges; the UI deliberately displays all returned evidence_edges. Café draft saves remain paused because indexing for wb_cafe / wb_cafe_drafts is stalled; do not request live save retries without Josh authorizing them.

- Optional backend metadata (not blocking): a future contract change could add `/api/health.corpus` identity metadata (`id`, `display_name`, `description`, `fictional`) alongside counts, avoiding snapshot/ID-prefix detection. Current café UI works with contract v1 and needs no backend change.

- LIVE draft gate, same run, backend owner: draft `e29a595f-80fe-449d-bc3c-29a1ac27150b` returned 201/pending and remained `provider_indexing: pending`, `retrieval_verification: pending`, `verified_via: null` after 99 GET polls over two minutes, then became **failed** at the backend's 600-second limit with error "Timed out before the draft could be indexed and read back." `verified_via` stayed null. Please investigate provider ingestion/status; indexing is the sole exception to the accepted live pass. Do not ask the web lane to retry live draft creation until Josh authorizes it. Web verification is bounded to 60 seconds and exposes **Check draft status** to resume; live checks now stop before saving a draft, per Josh. Fixtures indexed after two reads and did not model this long delay. No provider state or keys were changed by the web lane.

- Backend/integration: allow exact origin `http://localhost:3100` for API ports 8000 and 8001; allow GET, POST, OPTIONS and headers Content-Type/Accept. The UI makes direct cross-origin fetches, with no proxy or restrictive connect-src policy. Implement `GET /api/health -> HealthResponse`, `GET /api/decisions -> DecisionList`, `GET /api/decisions/{doc_id} -> DecisionDetail` (sections/quotes), `POST /api/ask` with `AskRequest -> StreamEvent SSE`, `POST /api/proposals/review` with `ProposalReviewRequest -> StreamEvent SSE`, `POST /api/drafts` with `DraftCreateRequest -> DraftRecord` (201 created, 200 existing, 409 ErrorBody/draft_conflict), `GET /api/drafts/{draft_id} -> DraftRecord`. All names refer to generated `packages/contracts/src/api.d.ts`. Close each SSE stream after exactly one terminal, preserve request_id, start seq at 0 and increment by 1. Errors before streaming return non-200 JSON ErrorBody. Indexed drafts must include provider_indexing=completed, retrieval_verification=verified, verified_via=hydradb|local_store. Do not report indexed before independent retrieval verification. Live stream calls verified; draft indexing/readback currently fails as documented above.
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
| 20. Layout/screenshots | PASS | 20 PNGs under apps/web/test-results/fixtures/checklist-all-stream-and-d-* (previous gate used test-results/checklist-all-stream-and-d-*): both widths for answer+graph, gap, abstention, stream error, review, pending/indexed/indexed_local/conflict/failed. Overflow checked at each capture; representative full-size views inspected. |
| 21. Docs | PASS | Run steps, port 3100, mock/live rules, seven endpoint shapes, exact CORS details and requested results.json shape above. |

All 47 updated backend tests passed with isolated dependencies and no copied keys: PYTHONPATH=$PWD/apps/api uv run --frozen --project apps/api pytest apps/api -p no:cacheprovider (UV_PROJECT_ENVIRONMENT outside repo). Data-only SSE dispatch has a dedicated unit test and the connected-API browser test. At that merge, provider calls were unverified; those isolated tests do not call HydraDB or the model. The separate live checkpoint above now records real stream success and draft failure. Runtime audit has no advisories; the documented lint-only audit finding remains deferred.
