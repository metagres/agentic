# Review Rounds Must Carry Findings

| Field | Value |
|---|---|
| Origin | Maintainer audit of requirements-review.yaml, change `rehome-improvement-review-canon` (2026-08-27) |
| Status | Proposed |
| Suggested change slug | `review-round-findings` |
| Depends on | Nothing hard; same write-time-enforcement theme as `ac-parent-backref-check` and `update-artifact-dry-run` |
| Kind | Review-kind contract extension (round schema + CLI flags; no envelope-shape change) |

## Problem

A review round records only `mechanical` (the shared `validateArtifact` output) and a decision
token. Three defects observed across four rounds in one change:

1. **Semantic findings have no home.** The reviewer's substantive findings (five blocking, three
   advisory in the originating review) exist only in the review conversation. The append-only
   history shows THAT v0.1.0 was rejected, never WHY. A fresh session resuming from artifacts
   cannot reconstruct the rationale — failing structured continuity (goal G-01): the artifact
   diff shows what changed, not what was wrong.
2. **Bare invocations append noise rounds.** The stage-opening call (no decision flag) records a
   `decision: review` round. Every verdict costs two rounds (inspection + decision); history
   fills with content-free entries.
3. **The recorded half is the redundant half.** The author's one-call finalize already runs
   mechanical validation at write time; the reviewer's mechanical re-check is independent
   verification worth keeping as a timestamp, but it is not the review's product. The semantic
   judgment is — and it is the part not recorded.

## Goal

- Round schema gains a `semantic` block (mirroring `mechanical`: valid / findings) populated from
  the semantic checklist outcome, plus a reviewer-findings field written through the CLI (e.g.
  `--reject --findings <file>` / `--note "..."`), so append-only history stays CLI-owned and
  complete: decision + mechanical + semantic + rationale in one round.
- Bare invocations stop appending rounds (inspection is not a review event); `--dry-run` remains
  the explicit no-write path, and a recorded inspection round, if ever wanted, becomes an explicit
  flag rather than a default.

## Non-goals

- No new top-level envelope fields; the findings ride the existing round structure.
- No retroactive edits to existing rounds (append-only holds; old rounds stay as they are).
- No change to who may write rounds (still the CLI on behalf of the bound reviewer).

## Design space & open questions

- **Findings input shape**: inline `--note` string vs `--findings <file>` referencing a structured
  YAML (blocking/advisory, target, fix) — the file form matches how authors already pass artifacts
  on stdin and keeps long rationales out of argv.
- **Semantic block population**: derived from the stage's `semantic-checks.yaml` walk (per-item
  pass/fail) vs free-form reviewer summary — likely both: mechanical-style per-item results plus a
  free-text rationale field.
- Open question: should `can_accept`/gate data move into the round's semantic block for one-stop
  reading?

## Expected saving

Every rejected round becomes self-sufficient: the author (or a fresh agent) reads one file and
knows what to fix and why. Today that rationale survives only in session transcripts — zero
durability. Also halves round noise by removing bare-invocation entries.

## Tradeoff / risk

Reviewer agents must actually supply findings — a convention the CLI should nudge by naming the
field in the review envelope's instructions. Risk of bloated rounds is managed by the file-input
form. Consumer test passes trivially: the author after a rejection, every future resuming session,
and audits all read review files today.

## Kickoff

```sh
sdlc requirements --change review-round-findings --request "Extend the review-kind round contract: rounds record a semantic block (checklist outcome) and reviewer findings supplied via CLI flags (--findings file or --note), so append-only history answers why an artifact was rejected; bare invocations stop appending inspection rounds."
```
