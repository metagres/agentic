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
  `runAuthoringStage` (`:613`) is the generic authoring interpreter. The step
  machine itself lives in `../authoring-base.ts` (`detectStep`,
  `isReadyForReview`, `getData`, `CANONICAL_STEPS`). Key sub-behaviors:
  `createChangeDir` (`:135`, slug via `slugify` (word-boundary truncation at
  60 chars)/`uniqueSlug` under
  `docs/changes/`; with `--change <name>` + `--request` and no matching dir it
  creates under the exact name via `validateChangeSlug`, else throws
  `ChangeSlugError` (`:115`, `INVALID_CHANGE_SLUG`/`CHANGE_DIR_EXISTS`)),
  `instantiateArtifact` (`:74`, renders the stage
  `template.yaml` with title/`request_summary`/`based_on_*`/date tokens,
  status `draft`, version `0.1.0`), `applyUpdateArtifact`
  (`:260`, merges stdin YAML over the artifact preserving existing
  status/version/created; delta arrays in the merge are normalized like
  `--append-delta` — phase defaults from the stage delta phase, date to
  today, API-003), `appendDelta` (`:352`, validates each delta entry —
  `target_doc` must be listed in `docs/current/index.md` unless the index is
  missing (warning `DOCS_INDEX_MISSING`), `change` ∈ Add/Modify/Remove,
  `reason` ≥ 10 chars, `date` YYYY-MM-DD, Modify/Remove need
  `target_anchor` (verified via `headingExists`) or `entity_id` — then
  normalizes the entries before appending),
  `completeStep` (`:437`, manual completion for `assumptions`, `delta`,
  `init` plus the legacy `discovery`/`scenarios` names → sets
  `assumptions_reviewed`/`delta_reviewed`/`context_loaded`/
  `discovery_reviewed`/`scenarios_reviewed`),
  `finalizeArtifact` (`:470`, validation pass → version bump (explicit
  `--bump-version`, else `patch` from `rejected` / `minor` from `accepted`) →
  status `ready-for-review`), `markMutated` (`:207`,
  downgrades status to `draft` unless already `draft`/`rejected` or
  `--keep-status`). Hooks extension points: `startup`, `getExtraData`,
  `recordAnswer`, `setClarity`, `preconditionWarnings` (`extraStep` is gone —
  `detectStep` derives the step purely from artifact state). The authoring
  flag surface is **engine-generated** (`helpPayload()` `:576` generates the
  usage from the stage descriptor — `stage.id`, `stage.artifact`, and the
  `steps.yaml` step ids), so `sdlc <stage> --help` is the authoritative flag
  list — the flags named in this codemap (e.g. `--update-artifact`,
  `--append-delta`, `--finalize`) are illustrative, not exhaustive, because
  manual enumerations drift.
- **Review — review-gated round log** (`review.ts`):
  `runReviewStage(stage, argv, cwd, options?)` (`:73`; `ReviewRunOptions`
  `:24` carries legacy `review --target` labels, TASK-008) resolves the
  `reviews` target, pre-flights reviewer input before any write — `--note`
  xor `--findings <file>`, both requiring a verdict, parsed via
  `parseFindingsFile`/`validateSemanticWalk`/`resolveFindingTargets` from
  `../review-findings.ts` (a malformed shape refuses the invocation; unknown
  id-shaped finding targets only warn) — runs `evaluateGate` (review gate:
  tracked artifact `ready-for-review` or `accepted`), runs the unified
  `validateArtifact` against the *target* stage's artifact, and computes
  `canAccept = readyForReview && blocking.length === 0`. Decision rules:
  `--reject` is refused without reviewer input when mechanicals pass;
  `--accept` with passing mechanicals requires the complete semantic walk
  (one `{check_id, status, evidence}` item per semantic check, all `pass`).
  Applies `--accept` (sets the target's `statusField` to `accepted`) /
  `--reject` (sets `rejected`) / no-decision (advisory with the semantic
  checklist), honoring `--dry-run` (no writes). Round store: a bare run
  opens a round with `status: 'open'` or refreshes the open round in place
  (round numbers increment only on append); a verdict completes the open
  round in place or appends a `closed` round `{round, reviewed_at,
  artifact_version, [implementation_status], decision, status, can_accept,
  mechanical{valid, blocking_count, findings}, [semantic{results}],
  [findings], [rationale], warnings}` — rationale per DEC-004 precedence:
  `--note` text, else the blocking-findings summary (`mechanicalRationale`
  `:68`), else omitted; reviewer findings without severity are blocking on
  a rejected round, advisory on an accepted one. Every non-dry run updates
  the review file (`stage.reviewFile || <stage-id>.yaml`) metadata
  (`latest_round`, `latest_decision`) — round history is never deleted
  (invariant §2.3; the single `open` round is the only mutable one).
  `reviewTargetToStageId` (`:708`) maps legacy `--target` values
  (`plan` → `planning`) to `<target>-review`.
- **Tasks — plan.yaml state machine** (`tasks.ts`):
  `runTasksStage` (`:124`) over `stage.artifact` (plan.yaml); envelope step
  is `task_update` with `--task-id`, otherwise `progress`. Allowed task
  statuses `ALLOWED_TASK_STATUS` (`:13`: pending, in_progress, done, blocked,
   skipped). Task update: `--task-id` + `--status` (both required,
   `MISSING_TASK_UPDATE_FIELDS`), optional
    `--note` (→ `implementation_note`; required when `--status done`,
    `TASK_DONE_REQUIRES_NOTE`), `--files "op:path,..."`
    (`parseFiles` `:54`, ops create/modify/delete, default modify); the
    interpreter owns `started_at`/`completed_at`/`files_changed`: stamps
    `started_at` on first `in_progress`, `completed_at` on `done`, and
    initializes `files_changed`; warns
    `UNPLANNED_FILE` for changes outside the task's planned `files`.
   `computeProgress` (`:79`) derives counts, `complete` (done+skipped ==
   total), and `next_task_ids` (pending tasks whose `depends_on` are all
   `done`). `implementation_status` transitions: `ready-for-review` when
   complete; `in_progress` when work is underway or a mutation reopens an
   `accepted` plan; `pending` initially. `GUARDRAILS` (`:21`) is injected into
   the non-complete instructions fields; the `complete` state points at
   implementation review.
- **Aggregator — delta collection** (`aggregator.ts`):
  `runAggregatorStage` (`:112`) for knowledge-extraction. Collects `delta`
  arrays from every registry stage with `producesDelta: true`
  (`loadStageRegistry(cwd).filter(s => s.producesDelta)`), annotating each
  entry with `source_stage`/`source_artifact`; `dedupeDeltas` (`:40`) then
  collapses near-duplicates per `target_doc`+`change` group (deltaAnchorIdentity
  `:20` — `anchor:`/`entity:` identities; latest entry wins, distinct
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
     (batch via `recordAnswersBatch` `:299`: YAML array of
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
     `metadata` + `review_report`; `step_help` is opt-in, included only when
     the invocation carries `--help-step` (DEC-003) → `writeJson` (state:
     `complete`/`in_progress`/`blocked`). A change root whose artifact is
     missing self-heals via `instantiateArtifact` (`ARTIFACT_INITIALIZED`).
   - review: pre-flight findings validation (before the gate, before any
     write) → gate → read target artifact (`ARTIFACT_NOT_FOUND` if missing) →
     `validateArtifact(targetStage.id, ...)` → decision (`accepted` /
     `accept_blocked` / `rejected` / `review`) → open/complete/append round →
     `writeJson` with `can_accept`, `blocking_findings`, `round`, `review_file`.
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
   (delta targets), `../review-findings.ts` (review findings file, semantic
   walk, finding-target resolution), `../ids.ts`, `../semver.ts`,
   `../stage-helpers.ts`, `../yaml-io.ts`, `../context.ts`, `../cli.ts`
   (envelope/exit), `../error-catalog.ts` (error codes: `STAGE_GATE_BLOCKED`,
   `CONFLICTING_DECISION`, `CANNOT_ACCEPT`, `REVIEW_NOT_PASSING`,
   `PLAN_NOT_FOUND`, `TASK_NOT_FOUND`, `INVALID_TASK_STATUS`,
   `MISSING_TASK_UPDATE_FIELDS`, `MISSING_CHANGE_DIR`,
   `IMPLEMENTATION_NOT_ACCEPTED`, ...).