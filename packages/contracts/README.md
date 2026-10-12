# @whybrain/contracts

Generated from `apps/api/whybrain/schemas.py`. Do not hand-edit anything here except this file.

- `openapi.json`, `schemas/*.json`: contract (OpenAPI 3.1 + per-model JSON Schema)
- `src/api.d.ts`: TypeScript types (`import type { components } from "@whybrain/contracts/src/api"`; `components["schemas"]["StreamEvent"]`)
- `fixtures/*.json`: sample responses; `stream_*.json` are full SSE event sequences. Every fixture is `fixture: true`, so the UI shows "Mock data" even when a fixture says LIVE.
- `npm run check` type-checks every fixture against the generated types.

Regenerate (contract commit only; see AGENTS.md): from repo root,
`uv run --project apps/api python scripts/export_contract.py && uv run --project apps/api python scripts/make_fixtures.py && (cd packages/contracts && npm run types && npm run check)`.
