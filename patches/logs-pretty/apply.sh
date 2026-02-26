#!/bin/bash
# Logs Pretty Formatter
# Adds --pretty flag to openclaw logs CLI

set -euo pipefail

log_info() { echo "[INFO] $@"; }
log_error() { echo "[ERROR] $@" >&2; exit 1; }

OPENCLAW_ROOT=$(npm root -g)/openclaw

# Check if formatter already exists in dist
if ls "$OPENCLAW_ROOT"/dist/logs-pretty-formatter*.js 1>/dev/null 2>&1; then
  log_info "Logs pretty formatter already present in dist."
  exit 0
fi

log_info "This patch requires building from fork source."
log_info "Run: cd ~/Projects/openclaw && npm run build && npm install -g ."
log_info "The patch is already committed in the alpha branch."
