# src/scripts/lib/kinds/

## Responsibility
The kind interpreters (DEC-006) — one execution model per stage `kind`,
selected from each stage's `stage.yaml`. Adding a stage of an existing kind
requires no TypeScript change; adding a kind is a design-review event.

## Design Patterns
- **Kind dispatch**: `runStage(stage, argv, cwd)` (`index.ts:11`) is a switch on
  `stage.kind` → `runAuthoringStage` / `runReviewStage` / `runTasksStage` /
  `runAggregatorStage`; an unknown kind throws (unreachable — the registry
  rejects unknown kinds at startup).
- **Authoring — flag loop + declarative step machine** (`authoring.ts`):
  `runAuthoringStage` (`:482`) is the generic authoring interpreter. The step
  machine itself lives in `../authoring-base.ts` (`detectStep`,
  `isReadyForReview`, `getData`, `CANONICAL_STEPS`). Key sub-behaviors:
  `createChangeDir` (`:109`, slug via `slugify`/`uniqueSlug` under
  `docs/changes/`), `instantiateArtifact` (`:74`, renders the stage
  `template.yaml` with title/`request_summary`/`based_on_*`/date tokens,
  status `draft`, step `init`, version `0.1.0`), `applyUpdateArtifact`
  (`:203`, merges stdin YAML over the artifact preserving existing
  status/version/created), `appendDelta` (`:224`, validates each delta entry —
  `target_doc` must be listed in `docs/current/index.md` unless the index is
  missing (warning `DOCS_INDEX_MISSING`), `change` ∈ Add/Modify/Remove,
  `reason` ≥ 10 chars, `date` YYYY-MM-DD, Modify/Remove need
  `target_anchor` (verified via `headingExists`) or `entity_id`),
  `completeStep` (`:311`, manual completion only for `assumptions`, `delta`,
  `init` → sets `assumptions_reviewed`/`delta_reviewed`/`context_loaded`),
  `finalizeArtifact` (`:340`, validation pass → version bump (explicit
  `--bump-version`, else `patch` from `rejected` / `minor` from `accepted`) →
  status `ready-for-review`, step `complete`), `markMutated` (`:150`,
  downgrades status to `draft` unless already `draft`/`rejected` or
  `--keep-status`). Hooks extension points: `extraStep`, `getExtraData`,
  `recordAnswer`, `setClarity`, `preconditionWarnings`.
- **Review — append-only round log + gate** (`review.ts`):
  `runReviewStage(stage, argv, cwd, options?)` (`:34`) resolves the `reviews`
  target, runs `evaluateGate` (review gate: tracked artifact
  `ready-for-review` or `accepted`), runs the unified `validateArtifact`
  against the *target* stage's artifact, computes `canAccept =
  readyForReview && blocking.length === 0`, applies `--accept` (sets the
  target's `statusField` to `accepted`) / `--reject` (sets `rejected`) /
  no-decision (advisory with the semantic checklist), honoring `--dry-run`
  (no writes). Every non-dry run appends a round `{round, reviewed_at,
  artifact_version, decision, can_accept, mechanical{valid, blocking_count,
  findings}, warnings}` to the review file
  (`stage.reviewFile || <stage-id>.yaml`) and updates its metadata
  (`latest_round`, `latest_decision`) — rounds are never deleted (invariant
  §2.3). `reviewTargetToStageId` (`:406`) maps legacy `--target` values
  (`plan` → `planning`) to `<target>-review`.
- **Tasks — plan.yaml state machine** (`tasks.ts`):
  `runTasksStage` (`:123`) over `stage.artifact` (plan.yaml). Allowed task
  statuses `ALLOWED_TASK_STATUS` (`:13`: pending, in_progress, done, blocked,
  skipped). Task update: `--task-id` + `--status` (both required), optional
  `--note` (→ `implementation_note`), `--files "op:path,..."`
  (`parseFiles` `:53`, ops create/modify/delete, default modify); stamps
  `started_at` on first `in_progress`, `completed_at` on `done`; warns
  `UNPLANNED_FILE` for changes outside the task's planned `files`.
  `computeProgress` (`:78`) derives counts, `complete` (done+skipped ==
  total), and `next_task_ids` (pending tasks whose `depends_on` are all
  `done`). `implementation_status` transitions: `ready-for-review` when
  complete; `in_progress` when work is underway or a mutation reopens an
  `accepted` plan; `pending` initially. `GUARDRAILS` (`:21`) is injected into
  every instructions field.
- **Aggregator — delta collection** (`aggregator.ts`):
  `runAggregatorStage` (`:29`) for knowledge-extraction. Collects `delta`
  arrays from every registry stage with `producesDelta: true`
  (`loadStageRegistry(cwd).filter(s => s.producesDelta)`), annotating each
  entry with `source_stage`/`source_artifact`; checks
  `plan.yaml metadata.implementation_status === 'accepted'` (warning
  `IMPLEMENTATION_NOT_ACCEPTED` otherwise; `--complete` hard-blocks on it).
  Default run lists `deltas_to_apply`; `--complete` writes
  `docs-delta.yaml` `{metadata{stage, status: complete, updated, change_root},
  deltas_applied}`.

## Data & Control Flow
All four share the same skeleton:
1. `parseArgs(argv)`; `--help` → usage envelope (exit 0).
2. Change root: `--change` → `resolveRootOrError` (authoring/review inline;
   tasks/aggregator via `requireChangeRoot`); authoring additionally accepts
   `--request` to create a new change dir.
3. Acceptance gate: `evaluateGate(stage, changeRoot, cwd)` (authoring only at
   `--finalize`; tasks/aggregator/review on every run) — failure → blocked
   envelope with `STAGE_GATE_BLOCKED` and `unsatisfied_requirements[]`,
   exit 1.
4. Kind-specific work (mutates the artifact/plan/review file via
   `writeYamlAtomic`):
   - authoring: optional mutation flags (`--next-ids`, `--update-artifact`,
     `--record-answer`, `--set-clarity`, `--append-delta`, `--complete-step`),
     then `--finalize` (gate → `validateArtifact` → blocking findings block
     with step `validation` → semantic checklist requires
     `--confirm-semantic` → `finalizeArtifact`), then the state-recalculation
     path: `validateArtifact` → `detectStep` → render the step's
      `markdown`/`commands` from `steps.yaml` (template vars `SDLC`,
      `change_name`, `stage`) → step-specific `data` (`existing_changes`,
     `next_ids`, `errors`, `delta_allowed_target_docs`) + `getData` booleans +
     `metadata` + `step_help` + `review_report` → `writeJson` (state:
     `complete`/`in_progress`/`blocked`).
   - review: gate → read target artifact (`ARTIFACT_NOT_FOUND` if missing) →
     `validateArtifact(targetStage.id, ...)` → decision (`accepted` /
     `accept_blocked` / `rejected` / `review`) → append round → `writeJson`
     with `can_accept`, `blocking_findings`, `round`.
   - tasks: gate → read plan (`PLAN_NOT_FOUND` if missing) → optional task
     mutation → `computeProgress` → `implementation_status` recompute →
     write on mutation → `writeJson` with `progress`.
   - aggregator: gate → collect deltas → optional `--complete` →
     `writeJson` with `deltas_to_apply`.
5. Any thrown error → blocked envelope with `INTERNAL_ERROR`, exit 4.

## Integration
- **Consumed by**: `src/scripts/sdlc.ts` via `resolveWorkflow`
  (`../workflows/index.ts:52`) and `runAuthoringStage` in `../runner.ts:12`.
- **Depends on**: `../stage-registry.ts` (discovery, hooks),
  `../steps-loader.ts` + `../authoring-base.ts` (step machine),
  `../validate.ts` (unified validation), `../requires-graph.ts` (gate),
  `../resolve-root.ts`/`../change-root.ts` (change dirs), `../docs-index.ts`
  (delta targets), `../ids.ts`, `../semver.ts`, `../stage-helpers.ts`,
  `../yaml-io.ts`, `../context.ts`, `../cli.ts` (envelope/exit),
  `../error-catalog.ts` (error codes: `STAGE_GATE_BLOCKED`,
  `CONFLICTING_DECISION`, `CANNOT_ACCEPT`, `REVIEW_NOT_PASSING`,
  `PLAN_NOT_FOUND`, `TASK_NOT_FOUND`, `INVALID_TASK_STATUS`,
  `IMPLEMENTATION_NOT_ACCEPTED`, ...).