#!/bin/bash
# Revert Logs Pretty Formatter
# Removes --pretty flag (requires rebuilding from upstream or reverting commit)

set -euo pipefail

log_info() { echo "[INFO] $@"; }
log_error() { echo "[ERROR] $@" >&2; exit 1; }

log_info "This patch is source-level. To revert:"
log_info "  cd ~/Projects/openclaw"
log_info "  git revert 871dcb0ac 954d1972d"
log_info "  npm run build && npm install -g ."
log_info "  openclaw gateway restart"
