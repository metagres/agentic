# Mine-Transcript Delegation Stem Bug

| Field | Value |
|---|---|
| Origin | Implementation session of `rehome-improvement-review-canon` (2026-08-27), implementer anomaly report (TASK-006 byte-identity runs) |
| Status | Landed in mine-transcript-delegation-stem 2026-08-28 |
| Suggested change slug | `mine-transcript-delegation-stem` |
| Depends on | Nothing |
| Kind | Bug fix (dev-only helper script; quick win) |

## Problem

`src/skills/improvement-review/scripts/mine_transcript.ts` counts delegation events with
`DELEGATION_RE = /\bdelegate(?:d|s|ion)?\b/`. The stem is wrong: "delegation" is "delegat" + "ion",
so the literal prefix "delegate" never occurs in it ("delegate" + "ion" would spell
"delegateion"). Verified byte-exact during the originating change's TASK-006: a transcript line
phrased exactly as SKILL.md documents ("delegation type=… model=… rework=…") yields
`delegations=0`; identical lines phrased "delegated"/"delegates" yield `delegations=2`.

Effect: silent under-counting of delegation events — one of the three FR-002 instrumentation
sub-fields — in the improvement review's primary evidence. No crash, no wrong non-zero number,
byte-identity unaffected; the number is just too low, which is the worst failure mode for an
evidence tool (the docs-index-parser lesson: a check that silently under-runs).

## Goal

Fix the stem (e.g. `/\bdelegat(?:e|ed|es|ion)\b/` or simply `/\bdelegat/` with boundary care) and
add a test fixture line phrased with "delegation" so the regression is mechanical.

## Non-goals

- No change to the event grammar or output shape (byte-identity contract per frozen DEC-008
  scoping applies to the fixed version).
- No retroactive re-mining of past transcripts unless the maintainer requests it.

## Design space & open questions

- Minimal stem fix vs grammar extension (e.g. also matching "subagent", "delegate_to") — the
  latter is a feature, keep it out of the bug fix; file separately if wanted.
- Where the fixture lives: the repo has no helper test harness (design DEC-004 of the introducing
  change chose execution evidence); a fixture file under the skill's scripts/ or a one-liner in
  the change's verification note.

## Expected saving

Delegation counts become trustworthy — the review's economics lens depends on them.

## Tradeoff / risk

Trivial; the only risk is scope creep into grammar changes (excluded above).

## Kickoff

```sh
sdlc requirements --change mine-transcript-delegation-stem --request "Fix the delegation-event stem in mine_transcript.ts (DELEGATION_RE can never match the word delegation because the literal prefix delegate does not occur in delegat+ion) and add a regression fixture line phrased with delegation so under-counting fails mechanically."
```
