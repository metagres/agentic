# `changes` and `status` Select the Current Stage by Different Rules

| Field | Value |
|---|---|
| Origin | Session implementing the CLI terminology contract / DEC-017 (2026-09-10): envelope slimming surfaced the divergence while rewriting the `changes` slim-shape test |
| Status | Proposed |
| Suggested change slug | `current-stage-consistency` |
| Depends on | Nothing |
| Kind | Defect fix (CLI selection logic single-sourcing) |
| Cost tier | Quick win |

## Problem

`changes` and `status` disagree on which stage is current for the same change.

- Symptom: for a fresh change, `changes` reports stage `design-review`
  (suggested_command `sdlc design-review --change <name>`) while `status`
  correctly reports `requirements`. The suggested review command is
  gate-blocked — a dead-end envelope for the orchestrator.
- Cause: `src/scripts/workflows/changes.ts:78-83` picks the first stage in the
  structural Kahn order (`computePipelineOrder`, `src/scripts/lib/requires-graph.ts:71`)
  whose tracked status is unsettled — no gate evaluation, no open-feedback
  priority. Review stages carry no `requires` edges (their readiness is
  gate-defined, `src/scripts/lib/requires-graph.ts:155-187`), so they are
  indegree-0 sources and the alphabetical tie-break (DEC-007) sorts
  `design-review` first.
- `src/scripts/workflows/status.ts:134-183` instead selects
  open-feedback → rejected → first incomplete stage whose gate is satisfied
  (`evaluateGate`), which is the orchestrator-correct answer.
- The disagreement also holds in the open-feedback state: `status` prioritizes
  `to_stage` (status.ts:104-127); `changes` only reports the feedback id and
  keeps its own unsettled pick as the stage.

## Fix

Extract status.ts's selection into one shared resolver (e.g.
`resolveCurrentStage(cwd, changeRoot)` → `{stage, state}`) and consume it from
both commands; `changes.ts` drops its own `unsettled` find. Per-change
`open_feedback` stays on the inventory entry.

## Acceptance

`changes.changes[i].stage === status.data.stage` (agent and suggested_command
follow from the stage) for the same change in all states: fresh,
ready-for-review, rejected, open-feedback, complete. The changes slim-shape
test currently expecting `design-review` for a fresh change (introduced in the
DEC-017 session, deviation note 5) flips to `requirements`.

## Docs

Verify the `stage`-semantics wording in `docs/current/api-contract.md` and
`docs/current/glossary.md` still holds after single-sourcing; add a DEC
follow-up entry per convention.
