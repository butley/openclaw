#!/usr/bin/env bash
# ElevenLabs Scribe STT helper for OpenClaw media.audio (Butley agent)
# Usage: elevenlabs-stt.sh <media-path> [lang]
set -euo pipefail

MEDIA_PATH="${1:-}"
LANG="${2:-pt}"

if [[ -z "$MEDIA_PATH" ]]; then
  echo "Error: missing media path" >&2
  exit 1
fi

if [[ ! -f "$MEDIA_PATH" ]]; then
  echo "Error: media file not found: $MEDIA_PATH" >&2
  exit 1
fi

# Prefer env var injected by orchestrator/runtime.
API_KEY="${ELEVENLABS_API_KEY:-}"

# Fallback: load from gateway env file if present.
if [[ -z "$API_KEY" && -f "$HOME/.openclaw/.env" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$HOME/.openclaw/.env"
  set +a
  API_KEY="${ELEVENLABS_API_KEY:-}"
fi

if [[ -z "$API_KEY" ]]; then
  echo "Error: ELEVENLABS_API_KEY not set" >&2
  exit 1
fi

curl -sS -X POST "https://api.elevenlabs.io/v1/speech-to-text" \
  -H "xi-api-key: $API_KEY" \
  -F "file=@$MEDIA_PATH" \
  -F "model_id=scribe_v1" \
  -F "language_code=$LANG" \
  | jq -r '.text // .transcript // .transcription // empty'
