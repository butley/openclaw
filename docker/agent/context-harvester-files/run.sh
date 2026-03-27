#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source .env
exec npx tsx harvester.ts
