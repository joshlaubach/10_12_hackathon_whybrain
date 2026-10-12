#!/usr/bin/env bash
# Maple Street Café (FICTIONAL sample corpus) API beside the PEP API: port 8002, collections
# wb_cafe (accepted) and wb_cafe_drafts. Keys come from the repo-root .env (never printed).
# Usage (repo root): scripts/run_cafe.sh      Override the port with PORT=8003.
set -euo pipefail
cd "$(dirname "$0")/.."
export CORPUS=cafe
export HYDRA_ACCEPTED_COLLECTION=wb_cafe
export HYDRA_DRAFTS_COLLECTION=wb_cafe_drafts
export DRAFTS_DIR="${DRAFTS_DIR:-$PWD/.drafts_cafe}"
export CORS_ORIGINS="http://localhost:3000,http://localhost:3100"
exec uv run --project apps/api uvicorn whybrain.main:app --app-dir apps/api --host 127.0.0.1 --port "${PORT:-8002}"
