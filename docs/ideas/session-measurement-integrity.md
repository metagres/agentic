# Supplied Session Transcripts Need Dedup and Their Own Measurement Kind

| Field | Value |
|---|---|
| Origin | Improvement-review run of 2026-09-07 (maintainer-invoked), findings E-3 and E-4; cycle in scope: `agents-working-sdlc-stages-are-too-verbose-in-chat-replies` (instrumentation notes absent — reconstructed-or-missing; reconstructed from 14 maintainer-supplied session transcripts); thin-signal check passed (6 changes with dated activity after 2026-08-28, no maintainer confirmation required) |
| Status | Proposed |
| Suggested change slug | `session-measurement-integrity` |
| Depends on | `session-evidence-supply` (proposed — this run exercised its option (a): transcripts were supplied on request; this proposal hardens the consuming side) |
| Kind | Dev-only skill method amendment (improvement-review SKILL.md + helper behavior + baseline rows; zero engine change) |
| Cost tier | Quick win |

## Problem

This run is the first to mine real supplied transcripts, and two measurement-integrity gaps
surfaced immediately. First, the miner counts duplicate files: 3 of the 14 supplied session
exports are byte-identical duplicates of other supplied files, so the mined invocation total
(176 events) overstates the unique-session count (139) by 37 events — session-derived numbers
silently double-count. Second, the artifact-volume metric now mixes kinds: the `sessions/`
folder inside the change holds 51,997 of the change's 53,399 measured lines (97.4%), so the
M-01-style "artifact volume" number for this change is dominated by supplied evidence files,
not durable change artifacts. Neither gap can mislead a careful reviewer today (the duplicates
are visible by inspection), but both will mislead run-over-run baseline comparisons once
session supply becomes routine.

## Evidence

All observations dated 2026-09-07; commands recorded beside every number.

- Duplicates: `md5sum docs/changes/agents-working-sdlc-stages-are-too-verbose-in-chat-replies/sessions/*.json`
  — one hash shared by 3 files (the review-implementation trio), two hashes shared by 2 files
  each (review-design pair, review-plan pair): 10 unique files among 14 supplied; 4 surplus.
- Mined inflation: `node src/skills/improvement-review/scripts/mine_transcript.ts <all 14 files>`
  reports 176 invocation events; the four surplus files contribute 37 (review-implementation 9×2
  surplus, review-design 9×1, review-plan 10×1). Unique-session total: 139.
- Volume mix: `node src/skills/improvement-review/scripts/measure_artifacts.ts --change
  agents-working-sdlc-stages-are-too-verbose-in-chat-replies --verbose` — change total 53399
  lines, of which the 14 `sessions/*.json` files hold 51997 lines (97.4%); the 8 durable
  artifact files total 1402 lines. `sessions/` exists in this change only — first instance of
  the convention (directory scan of `docs/changes/*/`, 2026-09-07).
- Baseline contact: M-12 (`docs/current/operations.md` `## Baselines`) is `pending` — "the first
  successful run records the initial value replacing this row". This run is that first
  successful run: 176 events mined (139 unique after dedup). M-01 (15306 lines, 2026-08-27,
  all changes) is not same-kind comparable to a single-change sessions-inclusive total — the
  sessions share needs its own row kind.

**What worked** (fairness note, dated): the supply practice proposed in
`docs/ideas/session-evidence-supply.md` (option (a)) worked on its first exercise — the
maintainer supplied 14 transcript paths at invocation, the miner consumed them all, and
instrumentation categories 1, 2, and 5 closed from reconstruction to measurement this run. The
pending M-12 row finally has its first value.

## Goal

Session-derived numbers are deduplicated by construction, and durable change artifacts are
measured separately from supplied session evidence, so run-over-run comparisons of both kinds
are honest without manual inspection.

## Non-goals

- No transcript discovery or hardcoded locations — the miner keeps taking explicit paths only.
- No change to the event grammar (the four-form delegation stem stays as shipped and tested).
- No engine, stage, or envelope changes; no new artifact types.
- No retroactive re-mining of past runs beyond recording M-12's first value.

## Design space & open questions

- **(a) Miner-side dedup** (recommended): `mine_transcript.ts` hashes supplied files (for
  example sha-256 of contents), mines each unique content once, and reports
  `duplicates_skipped: <n>` naming the skipped paths — zeros-are-not-data and explicit-report
  conventions preserved.
- **(b) Method-side dedup**: SKILL.md §5 gains one sentence instructing the reviewing agent to
  dedupe supplied files by hash before mining. Cheapest, but relies on the agent every run.
- Recommendation: (a) with (b) as the one-line recipe note — mechanical where mechanical is
  possible (G-08).
- **Volume-kind split**: `measure_artifacts.ts` gains an explicit exclusion of `sessions/`
  subdirectories from the durable-artifact total (or a separate `sessions` row), and the
  baselines gain a session-transcript-volume row (kind count, unit lines) as an
  initial-baseline candidate recorded by this landing change's knowledge extraction.
- Open question: should duplicate exports be prevented at export time instead (an export
  convention or helper)? Out of scope here — the maintainer's export flow is not toolkit
  surface; dedup at measurement time is sufficient.

## Requirement seeds

- FR-001: `mine_transcript.ts` mines each unique file content once among the supplied paths and
  reports the count and paths of skipped duplicates; totals reflect unique sessions.
- FR-002: `measure_artifacts.ts` reports durable change artifacts and `sessions/` evidence as
  separate rows (the durable total excludes `sessions/` subdirectories).
- FR-003: Baseline row M-12 is replaced by this landing change's knowledge extraction with the
  first mined value (176 events / 139 unique, 2026-09-07, command recorded), per the row's own
  recipe.
- FR-004: A new quantitative baseline row of kind count for session-transcript volume is
  recorded by this landing change's knowledge extraction (initial-baseline candidate; value
  51997 lines / 14 files / 10 unique, 2026-09-07).
- NFR-001: Zero changes under `src/scripts/`, `bin/`, `src/stages/`; helpers stay plain ESM
  TypeScript with node builtins only.

## Implementation sketch

1. `src/skills/improvement-review/scripts/mine_transcript.ts`: add content-hash dedup with the
   `duplicates_skipped` report; extend `test/unit/mine-transcript.test.ts` with a duplicate-input
   fixture.
2. `src/skills/improvement-review/scripts/measure_artifacts.ts`: exclude `sessions/` from the
   durable total and emit a separate row; extend its unit coverage if present.
3. `src/skills/improvement-review/SKILL.md` §5: one sentence — the miner dedupes by content and
   reports skipped duplicates.
4. Knowledge-extraction delta: Modify `docs/current/operations.md` `## Baselines` — replace
   M-12, append the session-volume initial-baseline row.
5. Verify: re-run both helpers against this change's sessions; totals drop to 139 unique and
   the durable total excludes sessions.

## References

- `docs/changes/agents-working-sdlc-stages-are-too-verbose-in-chat-replies/sessions/` — the 14 supplied files (4 byte-identical duplicates, md5-verified 2026-09-07)
- `src/skills/improvement-review/scripts/mine_transcript.ts`, `measure_artifacts.ts` — the two helpers this proposal amends (dev-only, skill-owned)
- `docs/current/operations.md` — `## Baselines` M-12 (pending) and M-01 (read-verified 2026-09-07)
- `docs/ideas/session-evidence-supply.md` — the supply-side proposal this consuming-side proposal hardens
- `docs/current/capabilities.md` — `## SDLC Goals` G-05 (every metric has a named consumer), G-08 (scripts-first)

## Governance-test-result

- No judgment placed inside the engine: compliant — dedup is a deterministic hash comparison in
  a dev-only helper; no engine or CLI surface changes.
- Capped check catalog untouched: no design-review governance event.
- Frozen CLI envelope untouched: no decision governance event.
- Canon mutation path: M-12 and the new volume row are recorded only through this landing
  change's knowledge extraction — compliant.

## Kickoff (new session)

```sh
sdlc requirements --change session-measurement-integrity --request "Harden session-evidence measurement: 3 of 14 supplied session transcripts in agents-working-sdlc-stages-are-too-verbose-in-chat-replies/sessions are byte-identical duplicates that inflated mined invocation counts from 139 unique to 176, and session JSON dominates the artifact-volume metric at 97.4% (51997 of 53399 lines), so add content-hash dedup with a duplicates_skipped report to mine_transcript.ts, split sessions/ out of the measure_artifacts durable total, and record M-12's first value plus a session-volume initial-baseline row via knowledge extraction."
```
