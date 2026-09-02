# Envelope State Flags Misrepresent Stage State

| Field | Value |
|---|---|
| Origin | Design session of `rehome-improvement-review-canon` (2026-08-27), architect anomaly report |
| Status | Proposed |
| Suggested change slug | `envelope-state-flags` |
| Depends on | Nothing |
| Kind | Engine bug fix (authoring kind interpreter; no envelope-shape change) |

## Problem

Two data flags in authoring envelopes misrepresent the step machine's real state (both observed
2026-08-27):

1. After `--update-artifact`, the envelope's top-level `step` field advances (for example to
   `ready`) but `data.metadata.step` still reports the stale value submitted in the artifact (for
   example `init`) until `--finalize` persists `step: complete`. A consumer keying on
   `data.metadata.step` acts on wrong state; the truth lives only in the envelope's `step` field.
2. At init, the empty artifact reports `semantic_complete: true` — the flag means
   "confirm-gated, not yet applicable", which the name misrepresents before any content exists
   that a semantic gate could evaluate.

## Goal

`data.metadata.step` reflects the step machine's current step after every state-changing call —
or the field is dropped from `data` in favor of the envelope `step` field as the single source of
truth. `semantic_complete` reports false (or an explicit not-applicable) until content exists for
the semantic gate to evaluate.

## Non-goals

- No new top-level envelope fields; the seven frozen fields stay untouched.
- No change to finalize or review semantics.

## Design space & open questions

- **(a) Sync `metadata.step` on every mutation** (the `markMutated` path) — smallest change.
- **(b) Remove `data.metadata.step`** and direct consumers to the envelope `step` field — cleaner,
  but requires the consumer test (goal G-05) over skill instructions and tests before removal.
- **`semantic_complete`**: revalue (false at init) vs rename — renaming ripples into skill
  instructions; revaluing is smaller. Open question for design.

## Expected saving

Eliminates a wrong-state consumer bug class: agents scripting against `data.metadata.step` stop
needing workarounds, and init-time flags stop asserting completeness that does not exist.

## Tradeoff / risk

Consumers may read these flags today (deployed skill instructions, unit tests); the fix must grep
consumers first and update them in the same change.

## Kickoff

```sh
sdlc requirements --change envelope-state-flags --request "Fix authoring envelope state flags: data.metadata.step must reflect the step machine's current step after every state-changing call (or be removed in favor of the envelope step field as single source of truth), and semantic_complete must not report true for an empty artifact at init."
```
