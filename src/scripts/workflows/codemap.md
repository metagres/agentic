# src/scripts/workflows/

## Responsibility
Top-level CLI commands of the sdlc CLI that are cross-cutting (not stages) —
`status`, `feedback`, `doctor` — plus `skillManifest`, the single source of
the deployed skill's identity/instructions. Stage commands are not defined
here; they are resolved from the stage registry and dispatched to kind
interpreters (see [../codemap.md](../codemap.md)). Knowledge-init bootstrap
has moved to a deployed skill (`.opencode/skills/knowledge-init/`), not a
workflow.

## Design Patterns
- **Cross-cutting command table + registry fallback**: `index.ts`
  `CROSS_CUTTING` (`:19`) maps command id → `{id, description, agent: null,
  run(argv)}`. Cross-cutting commands are never bound to a dedicated agent —
  `agent: null` means the current agent runs the command. `resolveWorkflow`
  (`:51`) applies `aliases` (`:40`: `docs`/`knowledge` →
  `knowledge-extraction`), checks `CROSS_CUTTING`, then falls through to
  `getStageById(cwd, id)` and wraps the stage as a `WorkflowEntry` whose `run`
  resolves `--cwd` and calls `runStage(stage, argv, cwd)` from
  `../lib/kinds/index.ts`. `listWorkflows()` (`:76`) returns per-stage entries
  with their bound `agent` plus the recommended `model` and `effectiveModel`
  (from `getAgentModelFields`, `model_override ?? model`) so an override is
  visible without reading source files; cross-cutting entries keep
  `agent: null` and carry no model fields.
- **Registry-derived pipeline status**: `status.ts` never hardcodes stage
  order — `computePipelineOrder(cwd)` (topological sort of the requires DAG,
  alphabetical tie-break) supplies the sequence; `trackedStage` (`:28`)
  resolves a review stage to the stage it `reviews`, and `readStageStatus`
  (`:37`) reads `metadata.<status_field>` of that tracked artifact.
- **Graph-aware cascade revert**: `feedback.ts` `downstreamStageIds(stageId,
  registry)` (`:15`) BFS over a reversed adjacency built from `requires` and
  `reviews` edges (a stage's acceptance depends on what it requires and what
  it reviews); a feedback entry reverts the target stage to `draft` and
  blocks every transitive downstream stage (`tasks` kind → `pending`, others
  → `blocked`), so unsatisfied gates cascade; resolving sets the `from`
  stage back to `in_progress` (tasks) or `draft`.
- **Static contract checks**: `doctor.ts` runs a fixed battery of
  `{id, passed, details}` checks and reports `blocked` only when errors
  accumulate; `--strict` promotes the missing-docs-index issue from warning
  to error.
- **Identity manifest**: `skill-manifest.ts` exports `skillManifest`
  (`{id: 'agentic-sdlc', title, description}` — the exact description text
  rendered into the deployed `SKILL.md` by `bin/deploy-to-agent.ts`) and
  re-exports `getStepDefinitions` from `../lib/steps-loader.ts` so step text
  is always loader-backed from each stage's `steps.yaml` (CMP-007).

## Data & Control Flow
1. **status** (`runStatus`, status.ts:54): `--change` → `requireChangeRoot` →
   `loadStageRegistry` + `computePipelineOrder` → per-stage `pipeline` map
   (each entry: `status`, bound `agent`, `model`, `effectiveModel`) → open
   `feedback.yaml` entry? → blocked envelope pointing at the feedback
   target (`current_workflow`, `suggested_command`, `open_feedback`) → else:
   first `rejected` stage wins (blocked) → else first not-done stage with a
   satisfied `evaluateGate` (done = `accepted`, or `complete` for the
   aggregator); a `ready-for-review` status redirects to its `<id>-review`
   stage → else `complete`. Output: `pipeline`, `change_name`, `change_root`,
   `current_workflow`, `suggested_command`, state
   `complete`/`in_progress`/`blocked`.
2. **feedback** (`runFeedback`, feedback.ts:68): `--change` resolved (via
   `resolveRootOrError`, mapping `AMBIGUOUS_CHANGE_DIR`/
   `CHANGE_DIR_NOT_FOUND`) → `feedback.yaml` loaded via `readYaml` (created
   as `{entries: []}` when missing). `--resolve <FB-id>`: mark entry
   `resolved` (+`resolved_at`), unblock the `from` stage
   (`tasks` → `in_progress`, else `draft`). New entry: requires
   `--from/--to/--reason`; both stages must exist and `to` must precede
   `from` (`downstreamStageIds(to)` contains `from`); then revert `to` →
   `draft`, block downstream stages, append entry
   `{id: nextId(..., 'FB'), from_stage, to_stage, reason, status: 'open',
   created_at}` via `writeYamlAtomic`.
3. **doctor** (`runDoctor`, doctor.ts:28): checks — `node_version` (≥ 20),
   `schemas_available` + `cli_envelope_schema` (presence of
   `cli-envelope.schema.yaml`), `policies_available`, `stages_available` +
   `stage_folders` (registry discovery, which itself validates every
   descriptor against the meta-schema and per-kind file sets) +
   `requires_dag` (`computePipelineOrder`), `deployed_manifest` (skipped in
   the repo; in a deployed runtime verifies `name`/`version`/`cliPath` in
   `manifest.json`), optional `change_name` resolution (via
   `resolveRootOrError`, mapping `AMBIGUOUS_CHANGE_DIR`/
   `CHANGE_DIR_NOT_FOUND` into the envelope), `docs_index_present`. State
   `blocked` iff any error; error codes include `NODE_VERSION_UNSUPPORTED`,
   `SCHEMAS_MISSING`, `POLICIES_MISSING`, `STAGE_INVALID_DESCRIPTOR`,
   `MANIFEST_INVALID`, `AMBIGUOUS_CHANGE_DIR`, `CHANGE_DIR_NOT_FOUND`,
   `INTERNAL_ERROR`; `DOCS_INDEX_MISSING` is warning unless `--strict`.
   Output `data` carries `cwd`, `strict`, the `checks` array, and
   `change_name`/`searched` when `--change` was supplied.
4. **skillManifest**: consumed by `bin/deploy-to-agent.ts` (`renderSkill`,
   manifest `name`/`version` in `manifest.json`) — not a runnable command.

## Integration
- **Consumed by**: `src/scripts/sdlc.ts` via `resolveWorkflow`/`listWorkflows`
  (index.ts); `skillManifest` by `bin/deploy-to-agent.ts`.
- **Depends on**: `../lib/` — `cli.ts` (`parseArgs`, `writeJson`, `EXIT`,
  `resolveCwd`, `CWD_FLAG_DOC`), `change-root.ts` (`requireChangeRoot`),
  `context.ts` (`safeReadYaml`), `yaml-io.ts` (`writeYamlAtomic`, `readYaml`),
  `error-catalog.ts`, `ids.ts` (`today`, `nextId`), `paths.ts`
  (`resolveRuntimeDir`), `requires-graph.ts` (`computePipelineOrder`,
  `evaluateGate`), `resolve-root.ts` (`resolveRootOrError`,
  `ResolveRootError`), `stage-registry.ts` (`loadStageRegistry`,
  `getStageById`, `getStageDescriptions`), `agent-registry.ts`
  (`getAgentModelFields`), `kinds/index.ts` (`runStage`), `steps-loader.ts`
  (`getStepDefinitions`, `StepDefinition`); reads per-change files
  (`feedback.yaml`, artifacts under `docs/changes/<dir>/`) and
  `docs/current/index.md`.
- **Produces**: status/feedback/doctor envelopes; `feedback.yaml` entries
  (append-only).
