# src/scripts/

## Responsibility
Runtime of the `sdlc` CLI — the single agent-facing entry point of the toolkit.
`src/scripts/sdlc.ts` is the process entry (npm bin/script `sdlc`, invoked as
`node scripts/sdlc.js` from the deployed skill). Its two subdirectories are mapped
separately: [lib/](lib/codemap.md) (engine core) and [workflows/](workflows/codemap.md)
(command handlers + the deployed-skill manifest).

## Design Patterns
- **Command dispatch via workflow resolution**: `sdlc.ts` takes `argv[0]` as the command;
  built-in flags (`--help`, `--version`, `--list-workflows`) short-circuit with
  `workflow: 'cli'` envelopes (sdlc.ts:9-64); anything else goes through
  `resolveWorkflow(command)` (`src/scripts/workflows/index.ts:51`), which first checks
  the `CROSS_CUTTING` table (status, feedback, doctor), then the stage registry
  (`getStageById`), applying `aliases` (`docs`/`knowledge` →
  `knowledge-extraction`). Every resolved entry carries the bound `agent` id;
  cross-cutting commands are never bound (`agent: null`). Unknown commands emit a
  `blocked` envelope with error code `UNKNOWN_COMMAND` and exit code `EXIT.usage` (2).
  `listWorkflows()` (`workflows/index.ts:76`) enriches each stage entry with
  `agent` plus the `model`/`effectiveModel` pair via `getAgentModelFields`
  (`src/scripts/lib/agent-registry.ts:132`).
- **Kind dispatch**: a resolved stage is executed by `runStage(stage, argv, cwd)` from
  `src/scripts/lib/kinds/index.ts` — the kind interpreter selected by the stage's
  `kind` field. `runAuthoringStage` in `src/scripts/lib/runner.ts:10` is the same
  path factored for direct stage invocation (parse args → `getStageById` →
  `runStage`), emitting `UNKNOWN_STAGE` for unresolvable ids.
- **Frozen envelope normalization**: `writeJson(payload, code, stagesDir?)`
  (`src/scripts/lib/cli.ts:144`) routes every payload through
  `normalizeEnvelope` (`cli.ts:58`), which guarantees the seven-field shape
  `{workflow, step, state, instructions, data, errors, warnings}`, strips legacy
  `data.next`/`data.next_action`, derives `instructions` from `instructions` →
  `instructions_for_llm` → `skill_instructions.markdown` → first error message, and
  coerces `state` into the four valid states (`ok`, `in_progress`, `blocked`,
  `complete`), mapping `pass`/`accepted` → `complete` and `fail`/`rejected` →
  `blocked`. For agent-bound stages it resolves the workflow id to a stage record
  and prepends the `delegationDirective(stage)` text from
  `src/scripts/lib/delegation.ts:21` as a distinct paragraph (CMP-002). `workflow`
  falls back to `stage` or `'cli'`; `_debug` is the only permitted passthrough into
  `data`.
- **Exit-code contract**: `EXIT` map (`cli.ts:6`) — `ok: 0, actionFailed: 1,
  usage: 2, ambiguous: 3, internal: 4`.
- **Arg parsing**: `parseArgs` (`cli.ts:14`) — flat `--key value` / `--key=value`
  parsing, booleans when no following value, positionals collected under `_`;
  `resolveCwd` (`cli.ts:49`) is the single `--cwd`-to-project-root derivation;
  `CWD_FLAG_DOC` (`cli.ts:55`) is the shared wording for that flag across help
  surfaces.

## Data & Control Flow
1. `node sdlc.js <command> [flags]` → `sdlc.ts` slices `process.argv` (sdlc.ts:6).
2. Built-in flag? → emit `cli` envelope via `writeJson` and exit 0.
3. Otherwise `resolveWorkflow(command)` (`workflows/index.ts:51`):
   - alias resolution → `CROSS_CUTTING` lookup → `getStageById(process.cwd(), id)`.
4. Stage found → its `WorkflowEntry.run(argv.slice(1))` resolves the effective
   `cwd` via `resolveCwd(parseArgs(argv))` and calls `runStage(stage, argv, cwd)`
   (kinds dispatcher). Cross-cutting handlers run directly:
   - `runStatus` (`status.ts:54`) — pipeline order from `computePipelineOrder`
     (requires-DAG topological sort), per-stage status read from the tracked
     artifact's metadata field (a review stage tracks the artifact of the stage it
     reviews), gate readiness via `evaluateGate`, open-feedback blocking, and
     per-stage `agent`/`model`/`effectiveModel` fields.
   - `runFeedback` (`feedback.ts:68`) — appends an open entry to `feedback.yaml`,
     reverts the target's tracked artifact to `draft`, cascades
     `blocked`/`pending` to downstream stages via the requires graph;
     `--resolve <FB-id>` closes the entry and unblocks the `from` stage.
   - `runDoctor` (`doctor.ts:28`) — checks node version, schemas/policies/stages
     dirs, stage registry + requires-DAG validity, deployed `manifest.json`,
     optional `--change` name resolution, and `docs/current/index.md`
     (`--strict` promotes its absence from warning to error).
5. The kind interpreter (authoring/review/tasks/aggregator) reads the stage folder
   config, the change dir, and `plan.yaml` as applicable, runs validation via
   `validateArtifact`, performs its state transitions, and returns control.
6. Every terminal path funnels through `writeJson`, which normalizes to the frozen
   envelope and `process.exit`s with the appropriate `EXIT` code.

## Integration
- **Consumed by**: npm bin/script `sdlc` (runs `src/scripts/sdlc.ts` directly); the
  bundled `dist/sdlc.js` (tsup) deployed as `scripts/sdlc.js` inside
  `.opencode/skills/agentic-sdlc/` (build artifact produced by
  `bin/deploy-to-agent.ts`, not source); e2e tests invoke it directly.
- **Depends on**: [lib/](lib/codemap.md) — `cli.ts` (envelope/exit),
  `stage-registry.ts` (stage discovery), `agent-registry.ts` (agent discovery +
  model-field surfacing), `delegation.ts` (delegation directives),
  `requires-graph.ts` (pipeline order + acceptance gate), `kinds/`
  (interpreters), `version.ts`. Also in lib/ (used by bins, not the CLI):
  `agent-permissions.ts` (kind permission contracts + stage↔agent compatibility),
  `agent-model-fields.ts` and `agent-prompt-marker.ts` (descriptor cross-checks
  for `bin/validate-policies.ts`), `review-findings.ts` (reviewer `--findings`
  validation for review stages), and `deploy/platforms/` (neutral→opencode
  agent-file renderers for `bin/deploy-to-agent.ts`); and
  [workflows/](workflows/codemap.md) — `resolveWorkflow`, `listWorkflows`,
  cross-cutting commands, `skillManifest`.
- **Discovers**: stage folders under `src/stages/` (see
  [../stages/codemap.md](../stages/codemap.md)) and agent definitions under
  `src/agents/` (via `agent-registry.ts`).
