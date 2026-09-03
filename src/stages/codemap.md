# src/stages/

## Responsibility
The structural source of truth for the pipeline (invariant §2.1). Every stage
is one folder under `src/stages/<stage-id>/` holding the stage's complete
declarative configuration — descriptor, steps, schema, structural checks,
semantic checklist, template. The engine discovers stages by scanning this
directory; no central file enumerates stages, and adding a stage of an
existing kind requires no TypeScript change. In the deployed bundle the whole
directory is copied next to the CLI and `hooks.ts` is compiled to `hooks.js`
(by `bin/deploy-to-agent.ts`).

## Stage Inventory
| Stage (folder) | Kind | Agent | Artifact / status field | requires | reviews / review file | Declared structural checks | Steps (steps.yaml) | Hooks | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `requirements/` | authoring | requirements-analyst | requirements.yaml / `status` | — | — | unique-ids, ref-exists ×3, referenced-by, duplicate-refs ×2, given-when-then, forbidden-words, sentence-count | needs_input, init, authoring, recovery, ready, complete | yes | Also carries `requirements-policy.yaml` (discovery gate policy); ONE merged `acceptance_criteria` list (id, Given-When-Then statement, category happy/edge/negative/boundary, parent_id) — no scenarios array; delta phase `Requirements`; next ids FR/NFR/AC/DL/SC |
| `requirements-review/` | review | stage-reviewer | requirements.yaml / `status` | — | requirements → requirements-review.yaml | — (no structural checks of its own; runs the target stage's) | needs_input, review, accept, reject | no | |
| `design/` | authoring | systems-architect | design.yaml / `status` | requirements-review | — | sentence-count, ref-exists, duplicate-refs | needs_input, init, authoring, recovery, ready, complete | yes | Cross-file `ref-exists` into requirements.yaml; delta phase `Design`; next ids CMP/DM/API/DEC |
| `design-review/` | review | stage-reviewer | design.yaml / `status` | — | design → design-review.yaml | — | needs_input, review, accept, reject | no | |
| `planning/` | authoring | task-planner | plan.yaml / `status` | requirements-review, design-review | — | unique-ids, ref-exists ×4, dependency-acyclic, dependency-order | needs_input, init, authoring, recovery, ready, complete | yes | Cross-file refs into requirements.yaml (covers, acceptance_ids) + design.yaml (design_refs); tasks array is the main body; milestones/risks required (milestone id/title/tasks/done_when; risk id/description/mitigation; empty arrays legal); milestone `tasks` refs checked against `tasks[].id`; delta phase `Planning`; next id TASK |
| `planning-review/` | review | stage-reviewer | plan.yaml / `status` | — | planning → **plan-review.yaml** (note: not `planning-review.yaml`) | — | needs_input, review, accept, reject | no | |
| `implementation/` | tasks | implementation-engineer | plan.yaml / `implementation_status` | planning-review | — | required-note-for-status, all-tasks-terminal | needs_input, progress, complete | no | Shares plan.yaml with planning; validates against planning's schema via `schema_from: planning` (no local schema.yaml); no template (not authoring); drives the task state machine |
| `implementation-review/` | review | stage-reviewer | plan.yaml / `implementation_status` | — | implementation → implementation-review.yaml | — | needs_input, review, accept, reject | no | |
| `knowledge-extraction/` | aggregator | knowledge-curator | docs-delta.yaml / `status` | implementation-review | — | — | needs_input, docs_delta, complete | no | Terminal stage; aliases `docs`/`knowledge` |

Per-kind file sets (CMP-009, enforced by the registry): authoring =
`stage.yaml` + `structural-checks.yaml` + `schema.yaml` + `template.yaml` +
`steps.yaml` + `semantic-checks.yaml`; review = `stage.yaml` + `steps.yaml`;
tasks = `stage.yaml` + `structural-checks.yaml` + `schema.yaml` +
`steps.yaml` + `semantic-checks.yaml`; aggregator = `stage.yaml` +
`steps.yaml` + `schema.yaml`. Optional `hooks.ts` where noted. A descriptor
may declare `schema_from: <stage-id>` to delegate its artifact schema to the
named stage's `schema.yaml` — the artifact contract is declared once by the
owning stage, the local `schema.yaml` is waived for that stage, and a missing
target or local coexistence is a hard startup error. `implementation/` uses
this for the shared `plan.yaml` (`schema_from: planning`).

## Design Patterns
- **Declarative configuration over code**: `stage.yaml` is the descriptor
  (`version, id, kind, title, artifact, status_field, requires, reviews,
  review_file, next_ids, produces_delta, delta_phase, title_prefix,
  title_default`) and validates at startup against the engine meta-schema
  `src/schemas/stage.schema.yaml`. Missing descriptor, invalid YAML, unknown
  kind, or folder/id mismatch is a hard startup error naming the folder.
  Two optional descriptor fields bind a stage to a dedicated agent: `agent`
  (the agent id from `src/agents/<id>.yaml`; absent means the current agent
  runs the stage) and `permissions` (per-key `allow`/`ask`/`deny` overrides
  of the stage kind's permission contract). Every shipped stage declares an
  `agent`: `requirements-analyst`, `systems-architect`, `task-planner`,
  `implementation-engineer`, `knowledge-curator`, and `stage-reviewer`
  (shared by all four review stages).
- **Requires DAG + acceptance gate (DEC-007/DEC-008)**: pipeline order is a
  topological sort of the `requires` graph with an alphabetical stage-id
  tie-break — there is no sequence field. Migrated edges:

  ```
  requirements → requirements-review → design → design-review →
  planning (requires requirements-review AND design-review) → planning-review →
  implementation → implementation-review → knowledge-extraction
  ```

  A stage is runnable only when every required stage's tracked artifact is
  `accepted` (a review requirement's tracked artifact is the artifact of the
  stage it reviews); review stages are runnable when their tracked artifact is
  `ready-for-review` or `accepted`. Gate failures produce a blocked envelope
  naming each unsatisfied requirement and its current status. A requires cycle
  or missing reference is a hard startup error.
- **Step machine from steps.yaml**: `steps.yaml` defines the per-stage steps
  with `title`, `next_action`, `markdown` (LLM instructions, templated with
  `{{SDLC}}`, `{{change_name}}`, `{{stage}}`), `commands`, and declarative
  `complete_when` predicates (DM-003). Every authoring stage declares the
  same canonical six-step tour (needs_input, init, authoring, ready,
  complete, recovery), detected from artifact state; discovery/scenarios/
  assumptions guidance is folded into the `authoring` step, and any extra
  steps.yaml step beyond the six remains declarative, driven by its
  `complete_when` predicate. Finalize is one call (`--finalize
  --confirm-semantic`) evaluating gate, mechanical validation, and semantic
  confirmation; legacy `--complete-step` names are still accepted. Review
  stages declare needs_input/review/accept/reject; implementation declares
  needs_input/progress/complete; knowledge-extraction declares
  needs_input/docs_delta/complete.
- **hooks.ts — the only stage-specific code** (DEC-016; never participates in
  validation):
  - `requirements/hooks.ts` — the **discovery gate**: `discoveryGate(env)`
    reads `requirements-policy.yaml` (8 lenses: stakeholder, scope, interface,
    behavior, data, constraint, failure, outcome; clarity levels
    `clear`/`partial`/`vague` each with `required_lenses` and
    `min_resolved_questions`); the policy is fail-loud — a missing or
    malformed `requirements-policy.yaml` raises `STAGE_POLICY_MISSING` /
    `STAGE_POLICY_INVALID` (no silent fallbacks). The gate passes when every
    required lens has a resolved `discovery_log` entry and the resolved
    question count meets the minimum. Exports `startup` (loads/validates the
    policy before any command), `getExtraData` (exposes `discovery_gate`,
    `scenarios_state`, and `assumptions_complete` in the envelope),
    `recordAnswer` (allocates the next `DL-NNN` id and appends a
    resolved entry from `--lens/--question/--answer`; also driven per entry by
    batch `--record-answers <file>`), and `setClarity`
    (validates `clear|partial|vague`, writes `metadata.clarity`). The legacy
    `extraStep` export is retained but no longer consulted — step detection is
    purely from artifact state, with discovery/assumptions guidance folded
    into the `authoring` step.
  - `design/hooks.ts` — advisory `preconditionWarnings` (`PREVIOUS_STAGE_NOT_READY`
    when requirements.yaml is not ready-for-review/accepted) and
    `getExtraData` (`based_on_requirements`).
  - `planning/hooks.ts` — advisory `preconditionWarnings`
    (`PREVIOUS_STAGE_NOT_READY` for design.yaml, `REQUIREMENTS_NOT_READY` for
    requirements.yaml) and `getExtraData` (`based_on_design`,
    `based_on_requirements`).
- **Semantic advisory checklists**: each validating stage's
  `semantic-checks.yaml` lists natural-language review questions (e.g.
  requirements: observable AC results, negative paths, assumption evidence,
  scope contradictions; design: FR/NFR traceability coverage, decision
  rationale; planning: task granularity/verifiability/completeness;
  implementation: AC satisfaction, evidence of verification, refactor
  preservation). These are surfaced as a checklist during `--finalize`
  (requiring `--confirm-semantic`) and in review — advisory, not mechanical.
- **Delta production**: authoring stages with `produces_delta: true`
  (requirements, design, planning) accumulate `delta` entries (Add/Modify/
  Remove against `docs/current/` docs listed in `docs/current/index.md`)
  carrying `delta_phase` (Requirements/Design/Planning); knowledge-extraction
  aggregates them. Authoring stages never edit `docs/current/` directly
  (invariant §2.5).

## Data & Control Flow
Runtime consumption of this directory:
1. **Discovery**: `loadStageRegistry` (`src/scripts/lib/stage-registry.ts:176`)
   scans `src/stages/` (or the deployed sibling `stages/`), alphabetically;
   per folder: parse `stage.yaml` → meta-schema validation via
   `validateWithSchema` → folder/id equality → kind check → resolve the
   per-kind file set (missing file = startup error; `schema_from` resolves
   `files.schema` to the named stage's `schema.yaml`, with a missing target or
   local coexistence as a startup error) → detect `hooks.ts`/
   `hooks.js`.
2. **Graph**: `computePipelineOrder` (`src/scripts/lib/requires-graph.ts:71`)
   builds the DAG (missing ref / cycle = hard error); `evaluateGate`
   (`:147`) reads each requirement's tracked artifact
   (`metadata.<status_field>`) for the acceptance gate.
3. **Execution**: the kind interpreter for the stage reads the folder's
   `steps.yaml` (`steps-loader.ts`), `schema.yaml` + `structural-checks.yaml`
   (via `validateArtifact`), `semantic-checks.yaml` (finalize checklist),
   `template.yaml` (authoring instantiation), and dynamically imports
   `hooks.js`/`hooks.ts` (`loadStageHooks`).
4. **Skill manifest**: `src/scripts/workflows/skill-manifest.ts`
   (`getStepDefinitions`) loads step text from these folders for the deployed
   skill; `bin/deploy-to-agent.ts` copies the whole directory and compiles the
   hooks.

## Integration
- **Consumed by**: `src/scripts/lib/stage-registry.ts` (discovery),
  `src/scripts/lib/kinds/` interpreters, `src/scripts/workflows/`
  (status/feedback/doctor, skill-manifest), `bin/validate-policies.ts`
  (descriptor + checks + steps + schema validation),
  `bin/validate-templates.ts` (authoring templates), `bin/deploy-to-agent.ts`
  (bundle copy + hook compilation).
- **Depends on**: `src/schemas/stage.schema.yaml` (meta-schema), the capped
  check catalog (`src/scripts/lib/checks/` — see
  [../scripts/lib/checks/codemap.md](../scripts/lib/checks/codemap.md)),
  `src/policies/errors.yaml` (error codes in envelopes); runtime change-dir
  artifacts (`requirements.yaml`, `design.yaml`, `plan.yaml`, review files,
  `docs-delta.yaml`).
- **Produces**: no code — pure configuration plus three `hooks.ts` modules
  compiled into the bundle; per-change artifacts and deltas are written by the
  interpreters, not by this directory.