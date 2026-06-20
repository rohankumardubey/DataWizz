#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  ".github/workflows/ci.yml"
  "README.md"
  "docker-compose.yml"
  "run.sh"
  "backend/app/main.py"
  "backend/pyproject.toml"
  "backend/tests/test_app_smoke.py"
  "frontend/package-lock.json"
  "frontend/src/lib/api.ts"
  "frontend/src/lib/chart-handoff.ts"
  "frontend/src/lib/dataset-handoff.ts"
  "frontend/src/lib/utils.ts"
  "scripts/ci/check-frontend-imports.mjs"
  "scripts/ci/check-repository.sh"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    printf 'Required repository file is missing: %s\n' "$path" >&2
    exit 1
  fi
  if [[ "${CI:-false}" == "true" ]] && ! git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    printf 'Required repository file is not tracked by Git: %s\n' "$path" >&2
    exit 1
  fi
done

if grep -Eq '^lib/$|^lib64/$' .gitignore; then
  printf 'Rootless lib/ ignore rules can hide frontend/src/lib. Use /lib/ and /lib64/ instead.\n' >&2
  exit 1
fi

node scripts/ci/check-frontend-imports.mjs

printf 'Repository integrity checks passed.\n'
