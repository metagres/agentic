# api-contract.md

CLI toolkit: no HTTP endpoints. The contract surface is the `sdlc` command line and the frozen JSON envelope.

## Endpoints (CLI Commands)

| Method | Path | Auth | Request Shape | Response Shape | Source File | Schema Drift? |
|--------|------|------|---------------|----------------|-------------|---------------|
| CLI | sdlc --help / --version / --list-workflows | none (local process) | no args | envelope, data.workflows (each entry carries agent: id or null) | src/scripts/sdlc.ts | No |
| CLI | sdlc <stage-id> --change <change-name> [kind flags] | none | --change + flags per kind (authoring: --request, --finalize, --confirm-semantic, --help-step, --record-answers <file>; review: --accept, --reject, --dry-run; tasks: --task-id, --status, --note — required for --status done, else TASK_DONE_REQUIRES_NOTE) | frozen envelope | src/scripts/workflows/index.ts, src/scripts/lib/kinds/ | No |
| CLI | sdlc status --change <change-name> | none | --change | envelope, data.pipeline (per-stage agent: id or null) | src/scripts/workflows/status.ts | No |
| CLI | sdlc feedback --change <change-name> --from <stage> --to <stage> --reason "..." [--resolve <FB-id>] | none | --change, --from, --to, --reason, optional --resolve | frozen envelope | src/scripts/workflows/feedback.ts | No |
| CLI | sdlc doctor [--strict] | none | --strict optional | envelope with checks list | src/scripts/workflows/doctor.ts | No |
| CLI | node bin/deploy-to-agent.ts --dest <root> [--clean] [--skip-smoke] | none | dest, clean, skip-smoke | JSON report with skills array | bin/deploy-to-agent.ts | No |
| CLI | node bin/lint-artifact.ts <stage> <artifact> | none | stage id, artifact path | validateArtifact findings | bin/lint-artifact.ts | No |
| CLI | node bin/validate-{schemas,policies,templates}.ts | none | none | validation report; templates bin adds skills array | bin/validate-schemas.ts, bin/validate-policies.ts, bin/validate-templates.ts | No |

## Envelope

| Field | Type | Notes | Evidence |
|-------|------|-------|----------|
| workflow | string | command or stage id | src/schemas/cli-envelope.schema.yaml |
| step | string | internal step name | src/schemas/cli-envelope.schema.yaml |
| state | ok \| in_progress \| blocked \| complete | CLI response state | src/schemas/cli-envelope.schema.yaml |
| instructions | string | agent-facing next action | src/schemas/cli-envelope.schema.yaml |
| data | object | command-specific payload | src/schemas/cli-envelope.schema.yaml |
| errors | array | {code, message, fix?} from errors.yaml | src/policies/errors.yaml |
| warnings | array | advisory findings | src/policies/errors.yaml |

- Envelope top-level fields are frozen: no new fields may be added. Evidence: src/schemas/cli-envelope.schema.yaml (additionalProperties: false), AGENTS.md (invariant 8).
- `data.workflows[]` entries (from `--list-workflows` / `--help`) and per-stage entries in `data.pipeline` (from `status`) each carry an `agent` field: the bound agent id or null. Cross-cutting commands (status, feedback, doctor) are always null. The envelope top-level shape is unchanged.
- `data.step_help` (current step's title, markdown, commands, exit_criteria) is omitted from authoring envelopes unless the invocation passes `--help-step`; the seven top-level fields are unchanged. Evidence: src/scripts/lib/kinds/authoring.ts.

## Internal APIs

| Function | Purpose | Source File |
|----------|---------|-------------|
| loadAgentRegistry(cwd) | scans src/agents/ for YAML, validates each against agent.schema.yaml, returns the cached AgentRecords; throws naming the offending file | src/scripts/lib/agent-registry.ts |
| checkAgentCompatibility(stages, agents) | verifies every stage-to-agent binding (floors allow, ceilings deny, multi-binding union of floors / intersection of ceilings); deterministic | src/scripts/lib/agent-permissions.ts |
| getRenderer(platform, version?) | resolves platform + version to a renderer; latest is the default; throws PLATFORM_UNKNOWN listing supported platforms/versions | src/scripts/lib/deploy/platforms/index.ts |
| renderAgent(renderer, agent) | renders one neutral agent definition into the platform's native format (target-relative path + full content) | src/scripts/lib/deploy/platforms/ |

## Schema Reconciliation

| Schema File | Endpoints Covered | Drift |
|-------------|-------------------|-------|
| src/schemas/cli-envelope.schema.yaml | all sdlc CLI envelopes | No |
| src/schemas/stage.schema.yaml | stage.yaml descriptors (startup validation) | No |
| src/schemas/agent.schema.yaml | agent.yaml definitions (startup validation) | No |
| src/schemas/docs-delta.schema.yaml | docs-delta.yaml artifact written by knowledge-extraction | No |