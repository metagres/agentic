# P12 — Fast-Track Lane for Small Changes

| Field | Value |
|---|---|
| Origin | Session retrospective (2026-08), finding F7 of the process-economy review |
| Status | Proposed — partially de-risked by a manual micro-cycle |
| Suggested change slug | `fast-track-lane` |
| Depends on | Nothing hard; reads best after P11 (unrelated) |
| Kind | Process/engine feature (pipeline topology or gate policy) |

## Problem

Every change pays the same nine-stage toll regardless of size. The retrospective measured that
a genuinely small enhancement (explicit slug creation: 2 FRs, 3 ACs, 1 task) still walked
requirements → requirements-review → design → design-review → planning → planning-review →
implementation → implementation-review → knowledge-extraction.

A **manual micro-cycle** was run for that change by compressing execution (one artifact write
per stage, single-call finalize, batched CLI chains, one builder delegation). It worked and was
cheap — but the compression relied on orchestrator discipline, not machinery. Nothing prevents
the compression from being applied unevenly, and nothing records that a change *is* small.

Important counter-evidence to weigh honestly: after the process-economy reform (collapsed
six-step authoring tour, one-call finalize, merged criteria list, ~2s validate), the full
pipeline's overhead dropped substantially. The remaining cost of a micro change is mostly the
three separate artifacts and their three review rounds. Design whether the lane is still worth
engine machinery, or whether it only needs to merge artifacts.

## Goal

A first-class, recorded fast-track for small changes that preserves every quality gate that
matters while collapsing artifact ceremony:

- One merged intent artifact (problem + criteria + tasks) instead of three.
- One review round over that artifact instead of three.
- Implementation and knowledge-extraction unchanged.
- The lane is visible in pipeline state (`status`) so nobody wonders why stages are missing.

## Non-goals

- No weakening of validation: schema checks, structural checks, and semantic confirmation run
  on the merged artifact exactly as on the separated ones.
- No second class of review history: rounds stay append-only; the lane is recorded as data,
  not by skipping gates silently.
- No automatic classification of change size without user consent.

## Design space & open questions

### Q1 — What makes a change eligible?

Options:

- **Explicit opt-in at creation** (recommended): `--lane fast` (or reusing the new explicit
  slug creation: `--change <slug> --request "…" --lane fast`). The user judges; the toolkit
  records. No size heuristics to maintain or game.
- Size heuristics (≤N FRs, single component): brittle, gameable, and judgment already lives
  with the caller per the established division of labor.

### Q2 — How does the lane fit the requires DAG?

The DAG (`src/scripts/lib/requires-graph.ts`, per-stage `requires`/`reviews` in
`stage.yaml`) is structural truth; stage folders are discovered, not enumerated (invariant §2).
Options:

- **Option A — lane-aware gate evaluation**: record `lane: fast` in the change metadata;
  the acceptance gate treats the merged artifact as satisfying the tracked-artifact
  requirements of the collapsed stages. Least structural change, but the DAG semantics get a
  conditional — must be implemented carefully in `requires-graph.ts` and surfaced in `status`.
- **Option B — real fast stages**: add `intent` (authoring kind, merged template) +
  `intent-review` (review kind) stage folders whose `requires` chain feeds straight into
  `implementation`. Cleanest expression in the existing architecture (new folders, zero engine
  change — the founding invariant), but changes the default pipeline shape for everyone unless
  the standard chain also stays selectable.
- **Option C — no engine change**: codify the manual micro-cycle as guidance (a documented
  checklist in AGENTS.md/skill) and keep running all nine stages compressed. Cheapest;
  matches what actually happened; but leaves the lane unrecorded and unenforced.

Recommendation: decide between B (structural, honest, more work) and C (documentation-only).
Option A is the fallback if B's dual-pipeline complexity proves real. Note the new-stage-folder
e2e (`test/e2e/new-stage-folder.test.ts`) already proves Option B needs no TypeScript change —
that is a strong argument for B.

### Q3 — What does the merged intent artifact contain?

Seed shape (subject to the normal requirements/design pass):

- `metadata` (id INT-NNN, title, status, version, based_on nothing)
- `problem_statement`
- `acceptance_criteria` (merged model: id / Given-When-Then / category / parent_id)
- `tasks` (planning task shape)
- `delta`
- Traceability collapses into `parent_id` on criteria (FR/NFR layer disappears for the lane —
  criteria point directly at… nothing? Or keep lightweight FR entries?). Open question: keep a
  minimal `functional_requirements` list so `parent_id` and `referenced-by` checks stay
  uniform, or introduce a lane-specific check set. Prefer keeping FR entries (uniformity beats
  cleverness; the capped catalog then works unchanged).

### Q4 — Which checks apply?

Reuse the existing per-stage check declarations where possible: the intent stage folder
declares its own `structural-checks.yaml` drawing from the same capped catalog
(unique-ids, ref-exists ×3, referenced-by, duplicate-refs, given-when-then,
forbidden-words, sentence-count). No catalog changes (invariant §2.11).

## Proposed shape (requirement seeds)

- FR-A: When a change is created with the fast lane selected, the system shall record the lane
  in the change metadata and expose it in `status` output.
- FR-B: The fast lane shall use an intent artifact and intent review replacing the
  requirements/design/planning triple, with all structural and semantic gates preserved.
- FR-C: Stages downstream of the lane (implementation, implementation-review,
  knowledge-extraction) shall behave identically to the standard pipeline.
- FR-D: A change created without the lane selection shall behave byte-identically to today.
- NFR: No capped-catalog changes; no envelope-shape changes; append-only review history holds
  for the intent review like any other.

Acceptance-criteria seeds: fast change shows `lane: fast` in status; intent artifact passes
lint via `bin/lint-artifact.ts`; standard change output unchanged (boundary); intent review
round appended and accepted/rejected like any review.

## Implementation sketch (if Option B)

1. New stage folders `src/stages/intent/` (authoring kind: stage.yaml, structural-checks.yaml,
   schema.yaml, template.yaml, steps.yaml, semantic-checks.yaml) and `src/stages/intent-review/`
   (review kind: stage.yaml reviews=intent, steps.yaml). Zero engine code — this is the
   discovery-by-directory promise being cashed in.
2. Topology wiring: `implementation.requires = [intent-review, …]`? Careful — the standard
   chain must remain available. This is THE hard question of Option B: two pipelines sharing
   downstream stages means `implementation` cannot simply require both chains. Possible
   resolutions: (a) `requires` accepts alternatives (engine change — violates "no central
   enumeration" spirit? no, it extends the meta-schema); (b) duplicate downstream stages per
   lane (folder explosion — reject); (c) lane recorded in change metadata and the gate skips
   unsatisfied standard-stage requirements when the lane flag is present (gate-level option A
   grafted onto B). Decide in design; do not start implementation before this is settled.
3. Template + checks for intent; e2e for the full fast path; docs.

## References

- Manual micro-cycle precedent: change `explicit-change-slugs-at-creation-passing-change-together`
  (2 FRs / 3 ACs / 1 task, compressed full pipeline, ~15 CLI calls total).
- Reform baseline that lowered full-pipeline cost:
  `streamline-the-sdlc-process-economy-collapse-the-authoring-s`.
- Stage-folder mechanics: `src/scripts/lib/stage-registry.ts` (`KIND_FILE_SETS`),
  requires graph: `src/scripts/lib/requires-graph.ts`, gate rules in AGENTS.md §5.
- Proof that new stage folders need no engine change: `test/e2e/new-stage-folder.test.ts`.

## Kickoff (new session)

```sh
sdlc requirements --change fast-track-lane --request "Add a first-class fast-track lane for small changes: an opt-in lane recorded at creation that replaces the requirements/design/planning triple with one reviewed intent artifact while preserving every validation gate and the standard pipeline for everyone else."
```

Settle Q2 (topology) in design before implementation; Q1/Q3/Q4 have recommendations above but
are open to revision with rationale.
