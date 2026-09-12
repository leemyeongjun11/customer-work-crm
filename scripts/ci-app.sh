#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${CRM_TEST_DATABASE_URL:-}" ]]; then
  echo 'Dedicated PostgreSQL test configuration is required; application checks were not completed.' >&2
  exit 1
fi
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm check
pnpm test:postgres
