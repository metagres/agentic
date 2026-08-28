# Baseline Rows Must Record Measurement-Time State

| Field | Value |
|---|---|
| Origin | Improvement-review run of 2026-08-28 (maintainer-invoked), finding E-1; cycles in scope: `sdlc-improvement-review-canon` pair — `sdlc-improvement-review-skill`, `rehome-improvement-review-canon` (instrumentation notes reconstructed-or-missing; artifact-derived evidence only) |
| Status | Proposed |
| Suggested change slug | `baseline-measurement-state` |
| Depends on | Nothing |
| Kind | Measurement-recipe governance (docs + knowledge-extraction delta; zero engine change) |
| Cost tier | Quick win |

## Problem

The quantitative envelope baselines M-02…M-10 (`docs/current/operations.md`, `## Baselines`) are
lifecycle-state snapshots, but the table records no state. Re-running the identical command on
the identical change one day later — after the change completed — produces deltas up to +277%
that are pure state drift, not regression. Any future run-over-run comparison will misread
these deltas; the comparability note ("compare same-stage rows by orders of magnitude") does not
cover same-stage-different-lifecycle-state comparisons.

## Evidence

All numbers carry command and date.

| Metric | Baseline (2026-08-27, `node src/skills/improvement-review/scripts/envelope_sizes.ts --change rehome-improvement-review-canon`) | Fresh (2026-08-28, same command) | Delta |
|---|---|---|---|
| M-08 implementation | 1530 B | 1025 B | −505 B (−33%) |
| M-09 implementation-review | 1125 B | 1848 B | +723 B (+64%) |
| M-10 knowledge-extraction | 970 B | 3658 B | +2688 B (+277%) |
| M-06 planning | 1227 B | 1224 B | −3 B |

Mechanism identified: the baseline rows were recorded on 2026-08-27 while
`rehome-improvement-review-canon` was mid-implementation (implementation tasks in progress →
larger `data`; knowledge-extraction not yet run → 970 B). The change completed 2026-08-27T21:49Z
(implementation-review round 1, accepted) and knowledge-extraction applied 8 deltas; the fresh
run measured the completed state. The helper already prints the measurement state beside every
row (`source=step:complete`, `source=step:progress`, `source=step:review`, `source=step:docs_delta`)
— the baseline table simply does not carry it.

Comparable, state-independent rows for contrast: M-01 artifact volume 15306 → 15531 lines
(+225, +1.5%; `measure_artifacts.ts`, 2026-08-27 vs 2026-08-28) and M-11 validate duration
2410 → 2712 ms (+302 ms, +12.5%, same order of magnitude; `validate_duration.ts`, machine-dependent
per its comparability note).

**What worked** (fairness note, dated evidence): write-time enforcement is confirmed working —
all 15 recorded review rounds across the two in-scope cycles show `mechanical.valid: true`,
`blocking_count: 0`; the only mechanical findings ever recorded in repository history (11 ×
`required-note-for-status`, `docs/changes/add-agent-agnostic-agent-definitions-deployed-alongside-the-/implementation-review.yaml`)
motivated the `TASK_DONE_REQUIRES_NOTE` write-time rejection that now exists
(`docs/current/operations.md` Commands row; `src/policies/errors.yaml`). Zero mechanical findings
survived to review in the two newest cycles — goal G-04 holding. The feedback channel also worked
end-to-end: FB-001 (`docs/changes/rehome-improvement-review-canon/feedback.yaml`, design →
requirements, 2026-08-27) was resolved same day through post-acceptance requirements rounds 5–6
(v0.1.1 → 0.1.2), and knowledge-extraction applied 8 deltas.

## Goal

Every state-dependent quantitative baseline row records the measurement-time step state, and the
measurement recipe instructs recording the helper's `source` field beside every number — so
run-over-run comparisons are same-state by construction and state drift is never misread as
regression.

## Non-goals

- No engine or helper changes — the helpers already print `source=step:<state>`.
- No retroactive reconstruction of what the 2026-08-27 state "really" was beyond what this
  proposal records; the refresh rows replace, not reinterpret.
- No change to the qualitative prose baselines (authoritative, never regenerated).
- No new baseline kinds.

## Design space & open questions

- **(a) State column in the quantitative table** (recommended): add a `State` column (values from
  the helper's `source` field, e.g. `step:complete`); timing rows record `n/a`.
- **(b) State folded into the comparability note** of each row — no table-shape change, but
  per-row prose is easier to skip when appending future rows.
- Open question: should the refresh re-measure at a canonical state (e.g. always `step:complete`
  for authoring stages) or simply record whatever state was measured? Recommendation: record the
  actual state; canonical-state measurement would forbid measuring a change mid-flight, which is
  exactly when baselines get taken.

## Requirement seeds

- FR-001: Each quantitative baseline row for envelope bytes carries the measurement-time step
  state, sourced from the helper's `source` field.
- FR-002: The improvement-review skill's measurement recipe (SKILL.md §4) instructs recording the
  `source` field beside every envelope number, matching the existing command-and-date rule.
- FR-003: M-02…M-10 are refreshed by this change's knowledge extraction with state recorded; the
  refresh notes in each row's comparability note that the 2026-08-27 values were mid-implementation
  snapshots.
- NFR-001: Zero changes to `src/scripts/`, `bin/`, or the helpers.

## Implementation sketch

1. Re-run `envelope_sizes.ts --change rehome-improvement-review-canon` (and one completed
   authoring-heavy change for breadth) during the change's implementation; record rows with state.
2. Knowledge-extraction delta: Modify `docs/current/operations.md` `## Baselines` — add the State
   column, refresh M-02…M-10, append one recipe sentence to the section preamble.
3. Delta: Modify `src/skills/improvement-review/SKILL.md` §4 recipe paragraph (one sentence).

## References

- `docs/current/operations.md` — `## Baselines`, rows M-01…M-12 (read-verified 2026-08-28)
- `src/skills/improvement-review/SKILL.md` — §4 measurement recipe, §12 failure paths
- `docs/changes/rehome-improvement-review-canon/implementation-review.yaml` — completion timestamp 2026-08-27T21:49Z
- `docs/changes/rehome-improvement-review-canon/docs-delta.yaml` — deltas_applied: 8
- `docs/current/capabilities.md` — `## SDLC Goals` G-02, G-05

## Governance-test-result

- No judgment placed inside the engine: compliant (docs + knowledge-extraction delta only).
- Capped check catalog untouched: no design-review governance event.
- Frozen CLI envelope untouched: no decision governance event.
- Canon mutation path: `docs/current/operations.md` is mutated only through this landing change's
  knowledge extraction — compliant with the read-only canon rule.

## Kickoff (new session)

```sh
sdlc requirements --change baseline-measurement-state --request "Record measurement-time step state on state-dependent quantitative baseline rows: add a State column (from the envelope_sizes helper's source field) to the operations.md quantitative baseline table, refresh rows M-02 through M-10 with state recorded, and add the record-the-source-field rule to the improvement-review measurement recipe, so run-over-run envelope comparisons are same-state by construction."
```
