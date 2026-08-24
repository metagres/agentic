# src/scripts/

## Responsibility
Runtime of the `sdlc` CLI — the single agent-facing entry point of the toolkit.
`src/scripts/sdlc.ts` is the process entry (npm bin `sdlc`, invoked as
`node scripts/sdlc.js` from the deployed skill). Its two subdirectories are mapped
separately: [lib/](lib/codemap.md) (engine core) and [workflows/](workflows/codemap.md)
(command handlers + the deployed-skill manifest).

## Design Patterns
- **Command dispatch via workflow resolution**: `sdlc.ts` takes `argv[0]` as the command;
  built-in flags (`--help`, `--version`, `--list-workflows`) short-circuit with
  `workflow: 'cli'` envelopes (`sdlc.ts:9-63`); anything else goes through
  `resolveWorkflow(command)` (`src/scripts/workflows/index.ts:52`), which first checks
  the `CROSS_CUTTING` table (status, feedback, doctor, docs-init), then the stage
  registry (`getStageById`), applying `aliases` (`docs`/`knowledge` →
  `knowledge-extraction`). Unknown commands emit a `blocked` envelope with error code
  `UNKNOWN_COMMAND` and exit code `EXIT.usage` (2).
- **Kind dispatch**: a resolved stage is executed by `runStage(stage, argv, cwd)` from
  `src/scripts/lib/kinds/index.ts` — the kind interpreter selected by the stage's
  `kind` field. `runAuthoringStage` in `src/scripts/lib/runner.ts:12` is the same
  path factored for direct stage invocation (parse args → `getStageById` →
  `runStage`), emitting `UNKNOWN_STAGE` for unresolvable ids.
- **Frozen envelope normalization**: `writeJson(payload, code)`
  (`src/scripts/lib/cli.ts:105`) routes every payload through
  `normalizeEnvelope` (`cli.ts:43`), which guarantees the seven-field shape
  `{workflow, step, state, instructions, data, errors, warnings}`, strips legacy
  `data.next`/`data.next_action`, derives `instructions` from `instructions` →
  `instructions_for_llm` → `skill_instructions.markdown` → first error message, and
  coerces `state` into the four valid states (`ok`, `in_progress`, `blocked`,
  `complete`), mapping `pass`/`accepted` → `complete` and `fail`/`rejected` →
  `blocked`. `workflow` falls back to `stage` or `'cli'`; `_debug` is the only
  permitted passthrough into `data`.
- **Exit-code contract**: `EXIT` map (`cli.ts:3`) — `ok: 0, actionFailed: 1,
  usage: 2, ambiguous: 3, internal: 4`.
- **Arg parsing**: `parseArgs` (`cli.ts:11`) — flat `--key value` / `--key=value`
  parsing, booleans when no following value, positionals collected under `_`.

## Data & Control Flow
1. `node sdlc.js <command> [flags]` → `sdlc.ts` slices `process.argv` (sdlc.ts:6).
2. Built-in flag? → emit `cli` envelope via `writeJson` and exit 0.
3. Otherwise `resolveWorkflow(command)` (`workflows/index.ts:52`):
   - alias resolution → `CROSS_CUTTING` lookup → `getStageById(process.cwd(), id)`.
4. Stage found → its `WorkflowEntry.run(argv.slice(1))` resolves the effective
   `cwd` from `--cwd` and calls `runStage(stage, argv, cwd)` (kinds dispatcher).
5. The kind interpreter (authoring/review/tasks/aggregator) reads the stage folder
   config, the change dir, and `plan.yaml` as applicable, runs validation via
   `validateArtifact`, performs its state transitions, and returns control.
6. Every terminal path funnels through `writeJson`, which normalizes to the frozen
   envelope and `process.exit`s with the appropriate `EXIT` code.

## Integration
- **Consumed by**: npm script `sdlc`; the bundled `dist/sdlc.js` (tsup) deployed as
  `scripts/sdlc.js` inside `.opencode/skills/agentic-sdlc/` (build artifact produced by
  `bin/deploy-to-agent.ts`, not source); e2e tests invoke it directly.
- **Depends on**: [lib/](lib/codemap.md) — `cli.ts` (envelope/exit),
  `stage-registry.ts` (discovery), `kinds/` (interpreters), `version.ts`; and
  [workflows/](workflows/codemap.md) — `resolveWorkflow`, `listWorkflows`,
  cross-cutting commands, `skillManifest`.
- **Discovers**: stage folders under `src/stages/` (see [../stages/codemap.md](../stages/codemap.md)).