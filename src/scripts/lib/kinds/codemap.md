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
  `runAuthoringStage` (`:677`) is the generic authoring interpreter. The step
  machine itself lives in `../authoring-base.ts` (`detectStep`,
  `isReadyForReview`, `getData`, `CANONICAL_STEPS`). Key sub-behaviors:
  `createChangeDir` (`:162`, slug via `slugify` (word-boundary truncation at
  60 chars)/`uniqueSlug` under
  `docs/changes/`; with `--change <name>` + `--request` and no matching dir it
  creates under the exact name via `validateChangeSlug`, else throws
  `ChangeSlugError` (`:96`, `INVALID_CHANGE_SLUG`/`CHANGE_DIR_EXISTS`)),
  `instantiateArtifact` (`:61`, renders the stage
  `template.yaml` with title/`request_summary`/date tokens,
  status `draft`, version `0.1.0`), `applyUpdateArtifact`
  (`:298`, merges stdin YAML over the artifact preserving existing
  status/version/created; delta arrays in the merge are normalized like
  `--append-delta` — phase defaults from the stage delta phase, date to
  today, API-003), `appendDelta` (`:390`, validates each delta entry —
  `target_doc` must be listed in `docs/current/index.md` unless the index is
  missing (warning `DOCS_INDEX_MISSING`), `change` ∈ Add/Modify/Remove,
  `reason` ≥ 10 chars, `date` YYYY-MM-DD, Modify/Remove need
  `target_anchor` (verified via `headingExists`) or `entity_id` — then
  normalizes the entries before appending),
  `completeStep` (`:475`, manual completion for `assumptions`, `delta`,
  `init` plus the legacy `discovery`/`scenarios` names → sets
  `assumptions_reviewed`/`delta_reviewed`/`context_loaded`/
  `discovery_reviewed`/`scenarios_reviewed`),
  `finalizeArtifact` (`:542`, validation pass → version bump (explicit
  `--bump-version`, else `patch` from `rejected` / `minor` from `accepted`) →
  status `ready-for-review`), `markMutated` (`:245`,
  downgrades status to `draft` unless already `draft`/`rejected` or
  `--keep-status`). Hooks extension points: `startup`, `getExtraData`,
  `recordAnswer`, `setClarity`, `preconditionWarnings` (`extraStep` is gone —
  `detectStep` derives the step purely from artifact state). The authoring
  flag surface is **engine-generated** (`helpPayload()` `:640` generates the
  usage from the stage descriptor — `stage.id`, `stage.artifact`, and the
  `steps.yaml` step ids), so `sdlc <stage> --help` is the authoritative flag
  list — the flags named in this codemap (e.g. `--update-artifact`,
  `--append-delta`, `--finalize`) are illustrative, not exhaustive, because
  manual enumerations drift.
- **Review — review-gated round log** (`review.ts`):
  `runReviewStage(stage, argv, cwd, options?)` (`:78`; `ReviewRunOptions`
  `:24` carries legacy `review --target` labels, TASK-008) resolves the
  `reviews` target and pre-flights reviewer input before any write —
  `--failures <file>` is valid only with `--reject`, `--note` is removed
  and `--findings` is renamed to `--failures`, and the file is parsed via
  `parseFailuresFile`/`validateSemanticFailures` from `../review-findings.ts`
  (a top-level YAML list of `{check, evidence}` entries; every check must be
  declared in the target stage's `semantic-checks.yaml`, no duplicates, no
  completeness requirement; a malformed shape refuses the invocation and
  nothing is written) — runs `evaluateGate` (review gate: tracked artifact
  `ready-for-review` only — an `accepted` artifact is already through the
  gate, so re-review requires the author to update and re-finalize), then
  the unified `validateArtifact` against the *target* stage's artifact.
  Every finding is a failure (failure-only contract) and mechanical
  failures are always CLI-computed — mapped to the uniform
  `{check, evidence}` shape with the fix hint folded into the evidence
  (`toFailure` `:47`), never reviewer-supplied. Decision rules:
  `--reject` requires `--failures` when mechanicals pass; `--failures` is
  refused while mechanicals fail and with `--accept`; `--accept` with
  failing mechanicals is a forced rejection (the round is recorded
  `rejected` and the artifact is flipped to `rejected`). Applies `--accept`
  (sets the target's `statusField` to `accepted`) / `--reject` (sets
  `rejected`) / no-decision (opens or refreshes the round, advisory with
  the semantic checklist), honoring `--dry-run` (no writes). Round store:
  rounds carry a merged `status` field (`open` | `accepted` | `rejected`)
  and `open` is the only mutable round; a bare run opens a round with
  `status: 'open'` or refreshes the open round in place, a verdict
  completes the latest open round in place, and a round is appended only
  when no open round exists (round numbers increment only on append) with
  shape `{round, reviewed_at, artifact_version, [implementation_status],
  status, mechanical_checks_passed, [semantic_checks_passed], failures}` —
  `semantic_checks_passed` is recorded only when the semantic checklist was
  dispositioned (accepted, or rejected with failed semantic checks). Every
  non-dry run updates the review file (`stage.reviewFile ||
  <stage-id>.yaml`) metadata (`latest_round`, `latest_status`) — round
  history is never deleted (invariant §2.3).
  `reviewTargetToStageId` (`:797`) maps legacy `--target` values
  (`plan` → `planning`) to `<target>-review`.
- **Tasks — plan.yaml state machine** (`tasks.ts`):
  `runTasksStage` (`:113`) over `stage.artifact` (plan.yaml); task updates
  ride the `--task-id`/`--status` flags and the envelope step is `progress`,
  `complete` once implementation reaches a terminal status. Allowed task
  statuses `ALLOWED_TASK_STATUS` (`:15`: pending, in_progress, done, blocked,
   skipped). Task update: `--task-id` + `--status` (both required,
   `MISSING_TASK_UPDATE_FIELDS`), optional
    `--note` (→ `implementation_note`; required when `--status done`,
    `TASK_DONE_REQUIRES_NOTE`), `--files "op:path,..."`
    (`parseFiles` `:43`, ops create/modify/delete, default modify); the
    interpreter owns `started_at`/`completed_at`/`files_changed`: stamps
    `started_at` on first `in_progress`, `completed_at` on `done`, and
    initializes `files_changed`; warns
    `UNPLANNED_FILE` for changes outside the task's planned `files`.
   `computeProgress` (`:68`) derives counts, `complete` (done+skipped ==
    total), and `next_task_ids` (pending tasks whose `depends_on` are all
    `done`). `implementation_status` transitions: `ready-for-review` when
    complete; `in_progress` when work is underway or a mutation reopens an
    `accepted` plan; `pending` initially. The `complete` state's
    instructions (steps.yaml markdown plus an annex) point at
    implementation review.
- **Aggregator — delta collection** (`aggregator.ts`):
  `runAggregatorStage` (`:114`) for knowledge-extraction. Collects `delta`
  arrays from every registry stage with `producesDelta: true`
  (`loadStageRegistry(cwd).filter(s => s.producesDelta)`), annotating each
  entry with `source_stage`/`source_artifact`; `dedupeDeltas` (`:42`) then
  collapses near-duplicates per `target_doc`+`change` group (deltaAnchorIdentity
  `:22` — `anchor:`/`entity:` identities; latest entry wins, distinct
  anchored edits kept separately) and sorts by target_doc/change/phase; warns
  `DOCS_INDEX_MISSING` on both paths when `docs/current/index.md` is absent
  (the CLI never creates `docs/current/`); warns `IMPLEMENTATION_NOT_ACCEPTED`
  when an existing plan.yaml has `implementation_status !== 'accepted'`
  (`--complete` hard-blocks on it). Default run lists `deltas_to_apply`;
  `--complete` writes
  `docs-delta.yaml` `{metadata{stage, status: complete, updated, change_root},
  deltas_applied}`.

## Data & Control Flow
All four share the same skeleton:
1. `parseArgs(argv)`; `--help` → usage envelope (exit 0); authoring also
   short-circuits `--describe` / `--describe-step <step>`.
2. Change root: `--change` → `resolveRootOrError` (authoring/review inline;
   tasks/aggregator via `requireChangeRoot`); unmatched change → blocked
   envelope `AMBIGUOUS_CHANGE_DIR`/`CHANGE_DIR_NOT_FOUND`, exit 3. Authoring
   additionally accepts `--request` to create a new change dir (`--change`
   + `--request` with no match creates under the exact provided name).
3. Acceptance gate: `evaluateGate(stage, changeRoot, cwd)` (authoring only at
   `--finalize`; tasks/aggregator/review on every run) — failure → blocked
   envelope with `STAGE_GATE_BLOCKED` and `unsatisfied_requirements[]`,
   exit 1.
4. Kind-specific work (mutates the artifact/plan/review file via
   `writeYamlAtomic`):
   - authoring: the flag set below is representative, not complete — the
     surface is engine-generated and `sdlc <stage> --help` is the
     authoritative list. Read-only `--next-ids`; mutation flags
      (`--update-artifact`, `--record-answer`, `--record-answers <file>`
      (batch via `recordAnswersBatch` `:337`: YAML array of
     `{lens, question, answer}` entries routed through
     the same `recordAnswer` hook per entry, sequential DL ids, failures
     name the entry index), `--set-clarity`, `--append-delta`,
     `--complete-step`),
     then `--finalize` (gate → `validateArtifact` → blocking findings block
     with step `recovery` → semantic checklist blocks with step
     `semantic_review` until `--confirm-semantic` → `finalizeArtifact`), then
     the state-recalculation path: `validateArtifact` → `detectStep` → render
     the step's `markdown`/`commands` from `steps.yaml` (template vars `SDLC`,
     `change_name`, `stage`) as the envelope instructions → step-specific
     `data` (`existing_changes`, `next_ids`, `errors`,
      `delta_allowed_target_docs`, `cli`/`runtime`) + `getData` booleans +
      `metadata` + `review_failures` (recovery step only: the latest
      rejected round's failures, read from the review stage's round store);
      `step_help` is opt-in, included only when
     the invocation carries `--help-step` (DEC-003) → `writeJson` (state:
     `complete`/`in_progress`/`blocked`). A change root whose artifact is
     missing self-heals via `instantiateArtifact` (`ARTIFACT_INITIALIZED`).
    - review: pre-flight `--failures` validation (before the gate, before
      any write) → gate → read target artifact (`ARTIFACT_NOT_FOUND` if
      missing) → `validateArtifact(targetStage.id, ...)` with mechanical
      failures CLI-computed → decision recorded as the round's merged
      `status` (`open` / `accepted` / `rejected`; `--accept` with failing
      mechanicals is forced to `rejected`) → open/complete round in place
      or append → `writeJson` with `status`, `failures`, `round`,
      `review_file`.
   - tasks: gate → read plan (`PLAN_NOT_FOUND` if missing) → optional task
     mutation → `computeProgress` → `implementation_status` recompute →
     write on mutation → `writeJson` with `progress`.
   - aggregator: gate → collect deltas → `dedupeDeltas` → optional
     `--complete` → `writeJson` with `deltas_to_apply`.
 5. Any thrown error → blocked envelope with `INTERNAL_ERROR`, exit 4.

## Integration
- **Consumed by**: `src/scripts/sdlc.ts` via `resolveWorkflow`
  (`../workflows/index.ts:51`, dispatched through `runStage` at `:65`) and
  `runAuthoringStage` in `../runner.ts:10`.
- **Depends on**: `../stage-registry.ts` (discovery, hooks),
   `../steps-loader.ts` + `../authoring-base.ts` (step machine),
   `../validate.ts` (unified validation), `../requires-graph.ts` (gate),
   `../resolve-root.ts`/`../change-root.ts` (change dirs), `../docs-index.ts`
   (delta targets), `../review-findings.ts` (review failures file:
   `{check, evidence}` parsing and semantic-failure validation), `../ids.ts`,
    `../semver.ts`,
   `../stage-helpers.ts`, `../yaml-io.ts`, `../context.ts`, `../cli.ts`
   (envelope/exit), `../error-catalog.ts` (error codes: `STAGE_GATE_BLOCKED`,
    `CONFLICTING_DECISION`, `REVIEW_NOT_PASSING`,
   `PLAN_NOT_FOUND`, `TASK_NOT_FOUND`, `INVALID_TASK_STATUS`,
   `MISSING_TASK_UPDATE_FIELDS`, `MISSING_CHANGE_DIR`,
   `IMPLEMENTATION_NOT_ACCEPTED`, ...).