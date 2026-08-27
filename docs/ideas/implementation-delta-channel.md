# Implementation-Phase Delta Channel

| Field | Value |
|---|---|
| Origin | Planning session of `rehome-improvement-review-canon` (2026-08-27), planner anomaly report |
| Status | Proposed |
| Suggested change slug | `implementation-delta-channel` |
| Depends on | Nothing hard; complements `review-round-findings` (same durability theme: session facts must land in repo artifacts, not transcripts) |
| Kind | Stage contract extension (implementation kind + schema phase enum; no envelope-shape change) |

## Problem

Implementation-stage facts that living docs need have no sanctioned path into the delta system.
Observed concretely in the originating change: the design's flow instructed "author the baseline
rows as delta entries, with values filled" during implementation — but the `phase` field is
enum-locked to `Planning` in both plan-bearing schemas, and the implementation CLI exposes no
`--append-delta` flag. The values had to travel in task `implementation_note`s, an informal
channel that knowledge extraction must know to mine. Any change whose implementation produces
measured values (baselines, counts, timings) hits this.

## Goal

An implementation-phase delta channel: either widen the `phase` enum with `Implementation` for
plan-bearing artifacts plus an `--append-delta` flag on the implementation CLI, or a sanctioned
structured note format that extraction consumes deterministically. Either way: values measured
during implementation reach living docs through the CLI-owned path, not through prose notes.

## Non-goals

- No new top-level envelope fields.
- No change to review-kind or authoring-kind delta semantics.
- No retroactive re-channeling of completed changes (their notes-based values stand).

## Design space & open questions

- **(a) Widen `phase` enum + implementation `--append-delta`** — symmetric with authoring stages;
  the tasks interpreter already owns `plan.yaml` state, so the writer exists.
- **(b) Structured note schema** (e.g. a `measurements:` block per task with a fixed row shape)
  that extraction parses — smaller, but formalizes a second channel instead of reusing the delta
  one.
- Open question: should the aggregator dedupe implementation-phase deltas the same way
  (per doc+change)? Presumably yes.

## Expected saving

Removes the informal notes-to-extraction convention before it calcifies; measured values gain the
same write-time validation and dedupe as every other delta. Directly serves G-08: the current
workaround relies on the extraction agent remembering to mine notes — judgment doing a script's
job.

## Tradeoff / risk

Widening the enum touches stage schemas (a governed surface — validate:policies territory); the
consumer test is strong (every baseline-producing change needs this; two changes in this repo
already hit it).

## Kickoff

```sh
sdlc requirements --change implementation-delta-channel --request "Give the implementation stage a sanctioned delta channel: widen the plan-bearing phase enum with Implementation and add --append-delta to the implementation CLI (or define a structured note schema extraction consumes deterministically), so values measured during implementation reach living docs through the CLI-owned delta path instead of prose task notes."
```
