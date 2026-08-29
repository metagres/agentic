# Tasks-Stage Re-Evaluate Persist

| Field | Value |
|---|---|
| Origin | Implementation-review round 2 of `mine-transcript-delegation-stem` (2026-08-28), reviewer advisory on recovery-path friction (reviewer had to re-assert a done task with its note passed verbatim to unblock the gate) |
| Status | Proposed |
| Suggested change slug | `tasks-stage-re-evaluate-persist` |
| Depends on | Nothing |
| Kind | Enhancement (tasks-kind CLI recovery path) |

## Problem

`runTasksStage` (`src/scripts/lib/kinds/tasks.ts`) persists plan.yaml only when a task mutation
occurred: line 377 gates `writeYamlAtomic` behind `if (mutation)`. The recomputed
`implementation_status` (lines 363–374) is otherwise envelope-only — a bare progress call reports
`ready-for-review` in its `data` (line 416) while the on-disk status stays whatever it was.

This creates a recovery dead-end after an upstream repair. When implementation-review rejects, the
CLI sets plan.yaml's `implementation_status: rejected`. If the fix happens upstream (e.g. the plan
artifact is repaired through the planning stage and planning-review re-accepts it), the
implementation stage's acceptance gate is satisfied again — but no non-mutating command restores
the stale `rejected` statusField. The only CLI path that persists anything is a task mutation, and
for a done task that transition hard-requires a non-empty `--note`
(`TASK_DONE_REQUIRES_NOTE`, tasks.ts line 276). The caller must therefore re-assert an already-done
task as done, passing its existing note verbatim (or drift the audit trail, or overwrite the note).
Verified during `mine-transcript-delegation-stem`: a bare progress call reported
`implementation_status: ready-for-review` in its envelope while the file still read `rejected`;
the round-2 reviewer had to repair it by re-asserting TASK-001 done with the original note passed
through a temp script so the note stayed byte-identical.

The schema-parity idea (`plan-schema-milestones-risks-parity`) would reduce how often this recovery
path is needed, but any implementation-review rejection followed by an upstream repair hits it, so
the gap remains.

## Goal

One explicit, CLI-owned way to persist the recomputed `implementation_status` without mutating a
task — a `--re-evaluate` flag on the tasks stage (recompute-and-persist, no task fields touched) or
clearing the downstream statusField when the reviewing stage accepts. Pick one at design; either
closes the dead-end.

## Non-goals

- No change to the frozen CLI envelope shape (invariant 8): a flag is argv surface, not a new
  top-level envelope field.
- No auto-persist on bare progress calls: a read-only progress command that silently writes state
  would be surprising; persistence stays behind an explicit flag or an explicit review-accept side
  effect.
- No change to `TASK_DONE_REQUIRES_NOTE` — the note guardrail stays for real done transitions.
- No change to the acceptance gate semantics (DEC-008) or to which stage owns which statusField.

## Design space & open questions

- `--re-evaluate` flag versus clear-on-accept in the review kind (`src/scripts/lib/kinds/review.ts`
  already writes the tracked artifact's statusField on accept — extending it to also reset the
  downstream stage's rejected statusField is a second write site; the flag keeps one write site).
- Interaction with the existing rule that a mutation on an accepted implementation reverts status
  to `in_progress` (tasks.ts line 368): re-evaluate must recompute only — it never sets a status
  the task states do not imply, and it must not clobber `accepted`.
- Scope: tasks kind only today, or a general mechanism for any stage whose statusField is written
  by a downstream review (authoring stages already have a recovery path via re-finalize, so the
  tasks kind is the only known sufferer).
- Flag naming and documentation surface: stage `steps.yaml` usage lines and `--help` output must
  carry it; a unit test in `test/unit/` covers the persist-without-mutation behavior (envelope
  status equals on-disk status after the call, task fields byte-identical).

## Expected saving

Recovery from an upstream repair becomes one explicit command instead of a note-verbatim task
re-assertion; removes both the audit-trail drift risk and the temp-script workaround reviewers must
resort to today.

## Tradeoff / risk

Low. New argv surface on one kind, documented in steps.yaml/usage and unit-tested; misuse risk
(using re-evaluate as a status reset hammer) is bounded because it is recompute-only — it can never
produce a status the underlying task states do not imply.

## Kickoff

```sh
sdlc requirements --change tasks-stage-re-evaluate-persist --request "Add a CLI-owned way to persist the recomputed implementation_status on plan.yaml without mutating a task — e.g. a --re-evaluate flag on the tasks stage that recomputes and persists without touching task fields, or clearing the downstream stage's rejected statusField when the reviewing stage accepts — because after an upstream repair clears an implementation-review rejection the only recovery path today is re-asserting a done task with its note passed verbatim (TASK_DONE_REQUIRES_NOTE forces it), which risks audit-trail drift."
```
