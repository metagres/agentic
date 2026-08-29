# Plan Version Not Bumped on Re-Finalize

| Field | Value |
|---|---|
| Origin | Implementation-review rounds 1–2 and planning-review round 2 of `mine-transcript-delegation-stem` (2026-08-28), repair round-trip observation |
| Status | Proposed |
| Suggested change slug | `plan-version-bump-on-refinalize` |
| Depends on | Nothing |
| Kind | Bug fix (artifact versioning; quick win) |

## Problem

Re-finalizing a repaired artifact does not bump its version. During the
`mine-transcript-delegation-stem` repair round-trip (2026-08-28), the plan was
updated (milestones/risks sections added to satisfy implementation-review),
re-finalized, and re-reviewed — yet `metadata.version` stayed `0.1.0` across
both planning-review rounds. A review round therefore cannot distinguish a
repaired artifact from the previously reviewed one by version alone, and the
append-only review history loses the content-delta signal that the version
field is meant to carry.

## Goal

Make the version field a reliable content-delta signal: re-finalizing an
artifact whose content changed since its last finalize bumps the version (at
least the patch component), so every review round reviews a distinct version.

## Non-goals

- No change to review files or round semantics (append-only history is
  untouched).
- No retroactive version bumps on already-accepted artifacts.
- No cross-artifact version equality checks (DEC-010 keeps `based_on_*` as
  provenance only).

## Expected saving

Review rounds can rely on the version field to detect that an artifact changed
between rounds; eliminates ambiguity when comparing rounds and when deciding
whether a re-review is looking at new content.

## Tradeoff / risk

Low. Version is provenance metadata; no validation depends on version
equality across artifacts. The main design question is where the bump belongs
(authoring `--finalize` versus the `--update-artifact` write path) and whether
unchanged-content re-finalizes should also bump.

## Kickoff

```sh
sdlc requirements --change plan-version-bump-on-refinalize --request "Make the artifact version a reliable content-delta signal: re-finalizing a changed artifact bumps its version so each review round reviews a distinct version (observed on mine-transcript-delegation-stem: the repaired plan stayed at 0.1.0 across two planning-review rounds)."
```
