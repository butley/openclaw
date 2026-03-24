# P21 — Chat Audio Inbound

**Branch:** `feat/rebase-3.22`
**Status:** ⏳ Pending — upstream removed `ChatAudioAttachment` type in v3.22

## What It Does

Enables the web dashboard to send audio attachments (browser-recorded voice messages) through the chat gateway. Audio is extracted, saved to disk, transcribed, and the transcript replaces the empty message body.

## Pending

Upstream v3.22 removed the `ChatAudioAttachment` type. Needs reimplementation against the new attachment model or a decision to drop. Awaiting Guilherme.

## Author

Guilherme — audio attachment handling.
