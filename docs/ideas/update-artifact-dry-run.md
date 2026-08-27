# Update-Artifact Dry-Run

| Field | Value |
|---|---|
| Origin | Authoring-session evidence, `rehome-improvement-review-canon` requirements round (2026-08-27) |
| Status | Proposed |
| Suggested change slug | `update-artifact-dry-run` |
| Depends on | Nothing hard; reads well after `ac-parent-backref-check` (same write-time-enforcement theme) |
| Kind | Authoring UX / write-time enforcement (CLI flag; no envelope-shape change) |

## Problem

`--update-artifact` accepts a full YAML file on stdin and writes it after validation. Three failure
modes observed in one session:

1. YAML quoting errors surfaced only as full write attempts — three consecutive round-trips
   (compose → pipe → parse error) before the file parsed.
2. No way to test a corrected file without attempting the write.
3. Full-file replacement on review-fix rounds forces re-emitting untouched sections, risking
   regressions in parts the author did not mean to change (observed in the
   `sdlc-improvement-review-skill` design fix round v0.1.0 → v0.2.0).
4. When the YAML does fail to parse, the CLI surfaces the raw parser message as an opaque
   `INTERNAL_ERROR` with fix text "Inspect the error details." — no hint that plain scalars
   containing `: ` need quoting or block scalars (observed three consecutive times in the
   `rehome-improvement-review-canon` authoring session, 2026-08-27).

## Goal

`--update-artifact --dry-run` validates the piped YAML — parse, schema, structural checks — and
reports findings without writing. The author learns the file is clean (or exactly what is wrong)
for one cheap round-trip instead of N write attempts.

## Non-goals

- No new top-level envelope fields (the flag rides the existing authoring flag loop).
- No change to the accepted artifact format.
- **Granular `--add-ac`-style flags explicitly not proposed**: round-trip economics favor batch
  files for initial authoring (one coherent document, fewest envelopes); the gap is validation
  timing, not flag granularity.

## Design space & open questions

- **(a) Dry-run flag** reusing `validateArtifact` on the candidate document — smallest change,
  matches the review stages' existing `--dry-run` precedent. Recommended now.
- **(b) Merge semantics** accepting partial sections while preserving CLI-managed fields
  (`step`, `status`, `version`) — structural; only pursue if fix-round regressions are observed
  again after (a) lands.
- Open question: should the dry-run output reuse the review-round findings shape for symmetry?

## Expected saving

Eliminates parse-error round-trips (three observed in a single session) and makes review-fix
rounds safe by construction — the author verifies the surgical edit before it can clobber anything.

## Tradeoff / risk

One more flag on the authoring surface — must pass the consumer test. Evidence it will: every
authoring session that hits a parse error or performs a post-rejection fix is a consumer, and both
occurred within this repository's last two changes.

## Kickoff

```sh
sdlc requirements --change update-artifact-dry-run --request "Add --dry-run to --update-artifact so piped artifact YAML is validated (parse, schema, structural checks) and findings reported without writing, eliminating parse-error round-trips and making post-rejection fix rounds safe by construction."
```
