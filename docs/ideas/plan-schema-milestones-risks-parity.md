# Plan Schema Milestones-Risks Parity

| Field | Value |
|---|---|
| Origin | Implementation-review rounds 1–2 and planning-review round 2 of `mine-transcript-delegation-stem` (2026-08-28), reviewer blocking findings and advisories |
| Status | Landed in plan-schema-milestones-risks-parity 2026-08-29 |
| Suggested change slug | `plan-schema-milestones-risks-parity` |
| Depends on | Nothing |
| Kind | Bug fix (declarative stage-schema alignment; quick win) |

## Problem

The planning and implementation stage schemas disagree on what a plan.yaml must contain.
`src/stages/planning/schema.yaml` requires only `metadata`, `tasks`, and `delta` (lines 6–10);
`src/stages/implementation/schema.yaml` additionally requires `milestones` and `risks` (lines 9–10).
The planning template scaffolds both sections (`src/stages/planning/template.yaml` lines 43–45) and
every other plan.yaml in the repo carries them, but nothing forces an author to keep them: a plan
that finalizes and passes planning-review is then guaranteed to fail implementation-review with
exactly two blocking schema findings ("doc must have required property 'milestones'" / "'risks'").
Reproduced byte-exact on `mine-transcript-delegation-stem`: plan-review round 1 recorded
blocking_count 0; implementation-review round 1 rejected on precisely those two findings; the repair
costed a full planning round-trip (update-artifact → re-finalize → planning-review round 2 →
implementation re-entry → implementation-review round 2) for a defect that was knowable at planning
finalize.

Secondary defect in the same sections: both schemas declare `milestones` and `risks` as bare
`"type": "array"` with no item constraints. The conventional shapes — milestone
(`id`/`title`/`tasks`/`done_when`) and risk (`id`/`description`/`mitigation`) — are convention-only,
un-enforced by schema or by any structural check, so a plan can carry empty or malformed milestones
and risks and still pass every gate.

## Goal

Make a plan complete at planning time: `src/stages/planning/schema.yaml` requires `milestones` and
`risks`, and both schemas gain item-level `properties`/`required` for the conventional milestone and
risk shapes so the convention is machine-checked declaratively.

## Non-goals

- No change to the capped check catalog (item constraints live in the per-stage schema.yaml —
  declarative — not in new structural checks; adding a check is a design-review event).
- No change to the tasks-kind interpreter's validation behavior: whether the implementation stage
  should schema-validate plan.yaml at finalize is a separate question (the review gate as the
  checker is the current design; `validateArtifact` has no caller in
  `src/scripts/lib/kinds/tasks.ts` today).
- No retroactive re-validation of already-accepted plans.
- No change to the planning template (it already scaffolds both sections).

## Design space & open questions

- Which side of the asymmetry to align: require the sections at planning (recommended — the
  template scaffolds them, every existing plan carries them, and the implementation schema already
  demands them) versus dropping them from the implementation schema (would weaken the review
  contract for no gain).
- Item constraints: how strict should `required` be inside each item — e.g. is `done_when` required
  on every milestone, is `mitigation` required on every risk, and do milestone `tasks` references
  warrant a `ref-exists` declaration in the stage's structural-checks.yaml (that path exists
  without touching the check catalog)?
- Adjacent observation from the same repair round-trip, decide in-scope or file separately:
  re-finalizing the repaired plan did not bump its version (0.1.0 across both review rounds), so a
  review round cannot distinguish a repaired artifact from the previously accepted one by version
  alone.
- Whether the schema asymmetry class has other instances across the nine stage schemas (a one-off
  audit of required-list parity between each authoring stage and the stage that consumes its
  artifact).

## Expected saving

Eliminates a guaranteed wasted review round per affected change: the missing-sections defect
surfaces at planning finalize (fast gate, seconds) instead of implementation-review (after all
implementation work is done), and the malformed-item class stops passing gates silently.

## Tradeoff / risk

Low. Existing accepted plans are unaffected (no retroactive validation); the only real risk is
over-constraining the item shapes for future plan kinds, which the design stage can tune by
choosing which item fields are `required` versus optional.

## Kickoff

```sh
sdlc requirements --change plan-schema-milestones-risks-parity --request "Align the planning stage schema with the implementation stage schema: require the milestones and risks sections in src/stages/planning/schema.yaml (implementation already requires them, so a plan that passes planning-review is guaranteed to fail implementation-review with two blocking schema findings) and give both schemas item-level properties and required fields for the conventional milestone (id, title, tasks, done_when) and risk (id, description, mitigation) shapes so the convention is machine-checked declaratively."
```
