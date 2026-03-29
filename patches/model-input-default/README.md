# P33 — Model Input Default: text + image

**Status:** ✅ Active
**Branch:** `feat/rebase-3.22`
**Files:** `src/config/defaults.ts`

## Problem

Upstream `DEFAULT_MODEL_INPUT` is hardcoded as `["text"]`. When `fillModelDefaults` runs on first boot for a new model, it persists `input: ["text"]` to `openclaw.json`. This permanently overrides the Pi SDK catalog value (which correctly defines `["text", "image"]` for vision-capable models like Anthropic Claude).

The result: vision silently breaks for every model that relies on the SDK catalog for its `input` definition. Images are dropped at `modelSupportsImages()` with zero errors.

## Upstream Bug

- `src/config/defaults.ts` line 42: `DEFAULT_MODEL_INPUT = ["text"]`
- `fillModelDefaults` (line ~241): `const input = raw.input ?? [...DEFAULT_MODEL_INPUT]` — persists to JSON when undefined
- `applyConfiguredProviderOverrides` in `model.ts`: `configuredModel.input ?? discoveredModel.input` — config wins over catalog

Related upstream issues:
- #43237 (Web UI images silently dropped)
- #25946 (chat.send images discarded — closed stale)
- #45867 (OpenRouter models missing input — closed)
- #42096 (guard optional model.input — partial fix, doesn't address persistence)

None of these fix the root cause.

## Fix

Changed `DEFAULT_MODEL_INPUT` from `["text"]` to `["text", "image"]`.

In 2026, virtually all major LLM providers support vision. Text-only is the exception, not the rule. Models that genuinely don't support images will have `input: ["text"]` explicitly set by their provider plugin or SDK definition.

## Risk

Low. Text-only models that correctly declare `input: ["text"]` in their plugin/catalog definition are unaffected — the default only applies when `input` is undefined. Worst case: a text-only model gets an image it can't process, which is better than silently dropping images from vision-capable models.

## Proper Upstream Fix

`fillModelDefaults` should NOT persist `input` when the user didn't explicitly set it. The SDK/plugin catalog should remain the source of truth. Config should only override when intentional.
