#!/usr/bin/env bash
# Demo API in one command: accepted decisions in wb_demo, drafts in wb_demo_drafts, port 8000,
# CORS for the web app on 3000 and 3100. Keys come from the repo-root .env (never printed).
# Usage (repo root): scripts/run_demo.sh      Override the port with PORT=8001.
set -euo pipefail
cd "$(dirname "$0")/.."
export HYDRA_ACCEPTED_COLLECTION=wb_demo
export HYDRA_DRAFTS_COLLECTION=wb_demo_drafts
export CORS_ORIGINS="http://localhost:3000,http://localhost:3100"
exec uv run --project apps/api uvicorn whybrain.main:app --app-dir apps/api --host 127.0.0.1 --port "${PORT:-8000}"
