# src/scripts/workflows/

## Responsibility
Top-level CLI commands of the sdlc CLI that are cross-cutting (not stages) —
`status`, `feedback`, `doctor`, `docs-init` — plus `skillManifest`, the single
source of the deployed skill's identity/instructions. Stage commands are not
defined here; they are resolved from the stage registry and dispatched to kind
interpreters (see [../codemap.md](../codemap.md)).

## Design Patterns
- **Cross-cutting command table + registry fallback**: `index.ts`
  `CROSS_CUTTING` (`:18`) maps command id → `{id, description, run(argv)}`.
  `resolveWorkflow(command)` (`:52`) applies `aliases` (`:41`:
  `docs`/`knowledge` → `knowledge-extraction`), checks `CROSS_CUTTING`, then
  falls through to `getStageById(process.cwd(), id)` and wraps the stage as a
  `WorkflowEntry` whose `run` resolves `--cwd` and calls `runStage(stage, argv,
  cwd)` from `../lib/kinds/index.ts`. `listWorkflows()` (`:73`) concatenates
  stage descriptions and cross-cutting entries.
- **Registry-derived pipeline status**: `status.ts` never hardcodes stage
  order — `computePipelineOrder(cwd)` (topological sort of the requires DAG,
  alphabetical tie-break) supplies the sequence; `readStageStatus` (`:36`)
  reads `metadata.<status_field>` of each stage's tracked artifact (a review
  stage's tracked artifact is the artifact of the stage it `reviews`,
  `trackedStage` `:27`).
- **Graph-aware cascade revert**: `feedback.ts` `downstreamStageIds(stageId,
  registry)` (`:15`) BFS over a reversed adjacency built from `requires` and
  `reviews` edges (a stage's acceptance depends on what it requires and what it
  reviews); a feedback entry reverts the target stage to `draft` and blocks
  every transitive downstream stage (`tasks` kind → `pending`, others →
  `blocked`), so unsatisfied gates cascade; resolving sets the `from` stage
  back to `draft`/`in_progress`.
- **Static contract checks**: `doctor.ts` runs a fixed battery of
  `{id, passed, details}` checks and reports `blocked` only when errors
  accumulate; `--strict` promotes the missing-docs-index issue from warning to
  error.
- **Template-seeded bootstrap**: `docs-init.ts` prefers the shipped
  `templates/docs-current-index.md` (via `findTemplate`, `:20`) over a built-in
  `DEFAULT_INDEX`, appends the `overview.md` row when absent, and refuses to
  overwrite an existing index without `--force`.
- **Identity manifest**: `skill-manifest.ts` exports `skillManifest`
  (`{id: 'agentic-sdlc', title, description}` — the exact description text
  rendered into the deployed `SKILL.md` by `bin/deploy-to-agent.ts`) and
  re-exports `getStepDefinitions` from `../lib/steps-loader.ts` so step text is
  always loader-backed from each stage's `steps.yaml` (CMP-007).

## Data & Control Flow
1. **status** (`runStatus`, status.ts:53): `--dir` → `requireChangeRoot` →
   `loadStageRegistry` + `computePipelineOrder` → per-stage `pipeline` status
   map → open `feedback.yaml` entry? → blocked envelope pointing at the
   feedback target (`current_workflow`, `suggested_command`) → else: first
   `rejected` stage wins (blocked) → else first not-done stage with a
   satisfied `evaluateGate` (done = `accepted`, or `complete` for the
   aggregator); a `ready-for-review` status redirects to its `<id>-review`
   stage → else `complete`. Output: `pipeline`, `current_workflow`,
   `suggested_command`, state `complete`/`in_progress`/`blocked`.
2. **feedback** (`runFeedback`, feedback.ts:68): `--dir` resolved →
   `feedback.yaml` loaded (created as `{entries: []}` when missing).
   `--resolve <FB-id>`: mark entry `resolved` (+`resolved_at`), unblock the
   `from_stage`. New entry: requires `--from/--to/--reason`; both stages must
   exist and `to` must precede `from` (`downstreamStageIds(to)` contains
   `from`); then revert `to` → `draft`, block downstream stages, append entry
   `{id: nextId(..., 'FB'), from_stage, to_stage, reason, status: 'open',
   created_at}`.
3. **doctor** (`runDoctor`, doctor.ts:28): checks — `node_version` (≥ 20),
   `schemas_available` + `cli_envelope_schema` (presence of
   `cli-envelope.schema.yaml`), `policies_available`, `templates_available`,
   `stages_available` + `stage_folders` (registry discovery, which itself
   validates every descriptor against the meta-schema and per-kind file sets)
   + `requires_dag` (`computePipelineOrder`), `deployed_manifest` (skipped in
   the repo; in a deployed runtime verifies `name`/`version`/`cliPath` in
   `manifest.json`), optional `change_dir` resolution, `docs_index_present`.
   State `blocked` iff any error; error codes include
   `NODE_VERSION_UNSUPPORTED`, `SCHEMAS_MISSING`, `POLICIES_MISSING`,
   `TEMPLATES_MISSING`, `STAGE_INVALID_DESCRIPTOR`, `MANIFEST_INVALID`,
   `DOCS_INDEX_MISSING`.
4. **docs-init** (`runDocsInit`, docs-init.ts:31): mkdir `docs/current/`;
   existing `index.md` without `--force` → ok + warning `DOCS_INDEX_EXISTS`;
   else write index (template or default, with overview row) and
   `overview.md`; state `complete`.
5. **skillManifest**: consumed by `bin/deploy-to-agent.ts` (`renderSkill`,
   manifest `name`/`version` in `manifest.json`) — not a runnable command.

## Integration
- **Consumed by**: `src/scripts/sdlc.ts` via `resolveWorkflow`/`listWorkflows`
  (index.ts); `skillManifest` by `bin/deploy-to-agent.ts`.
- **Depends on**: `../lib/` — `cli.ts`, `change-root.ts`, `context.ts`,
  `error-catalog.ts`, `ids.ts`, `paths.ts`, `requires-graph.ts`,
  `resolve-root.ts`, `stage-registry.ts`, `kinds/index.ts` (`runStage`),
  `steps-loader.ts` (`getStepDefinitions`); reads per-change files
  (`feedback.yaml`, artifacts under `docs/changes/<dir>/`) and
  `docs/current/index.md`.
- **Produces**: status/feedback/doctor envelopes; `docs/current/index.md` +
  `overview.md` (bootstrap only — living docs are thereafter maintained by
  knowledge extraction); `feedback.yaml` entries.