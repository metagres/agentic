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
| CLI | node src/skills/improvement-review/scripts/measure_artifacts.ts [--change <slug>] [--verbose] | none | optional --change slug filter, --verbose | artifact line-count rows per change under docs/changes/ (default ≤40-line summary; --verbose per-file); exit zero on empty datasets, non-zero naming unreadable paths | src/skills/improvement-review/scripts/measure_artifacts.ts | No |
| CLI | node src/skills/improvement-review/scripts/envelope_sizes.ts --change <slug> [--verbose] | none | required --change slug, --verbose | per-stage envelope byte rows (stage, step, bytes_total, bytes_per_field) for the nine stages; internally invokes the sdlc CLI per stage with mandatory --dry-run on the four review-stage invocations (bare review invocations append a round); byte-identical for identical repository state | src/skills/improvement-review/scripts/envelope_sizes.ts | No |
| CLI | node src/skills/improvement-review/scripts/mine_transcript.ts <file>... [--verbose] | none | one or more caller-supplied transcript files (never discovered), --verbose | event counts (sdlc invocations per command token, wasted-round candidates, delegation events with type=/model=/rework= sub-fields) with source filename beside every number; zero parseable events → explicit zero-extraction report + non-zero exit | src/skills/improvement-review/scripts/mine_transcript.ts | No |
| CLI | node src/skills/improvement-review/scripts/validate_duration.ts [--verbose] | none | --verbose | shape-stable fast-gate timing record (command, exit_code, duration_ms); duration_ms varies with machine and load — shape stability, not byte-identity; propagates validate failure non-zero with named cause | src/skills/improvement-review/scripts/validate_duration.ts | No |

- Authoring change creation: `--change` together with `--request` with no matching change directory creates the change under the exact provided slug, which must match `^[a-z0-9][a-z0-9-]*$` (max 60 chars, no trailing hyphen) and be unique among existing changes (errors `INVALID_CHANGE_SLUG` / `CHANGE_DIR_EXISTS`). Bare `--request` keeps the mechanical word-boundary fallback (slugify plus numeric suffix); an existing `--change` directory keeps resume semantics. Evidence: src/scripts/lib/ids.ts (validateChangeSlug), src/scripts/lib/kinds/authoring.ts (createChangeDir), src/policies/errors.yaml.

## Envelope

| Field | Type | Notes | Evidence |
|-------|------|-------|----------|
| workflow | string | command or stage id | src/schemas/cli-envelope.schema.yaml |
| step | string | internal step name | src/schemas/cli-envelope.schema.yaml |
| state | ok \| in_progress \| blocked \| complete | CLI response state | src/schemas/cli-envelope.schema.yaml |
| instructions | string | agent-facing next action; bound stages prepend a delegation directive paragraph (see below) | src/schemas/cli-envelope.schema.yaml, src/scripts/lib/delegation.ts |
| data | object | command-specific payload | src/schemas/cli-envelope.schema.yaml |
| errors | array | {code, message, fix?} from errors.yaml | src/policies/errors.yaml |
| warnings | array | advisory findings | src/policies/errors.yaml |

- Envelope top-level fields are frozen: no new fields may be added. Evidence: src/schemas/cli-envelope.schema.yaml (additionalProperties: false), AGENTS.md (invariant 8).
- `data.workflows[]` entries (from `--list-workflows` / `--help`) and per-stage entries in `data.pipeline` (from `status`) each carry an `agent` field: the bound agent id or null. Cross-cutting commands (status, feedback, doctor) are always null. The envelope top-level shape is unchanged.
- Bound-stage envelopes prepend a delegation directive to `instructions`: composed at the single envelope funnel (`normalizeEnvelope` resolving the workflow id via `getStageById`) from the declarative `StageRecord.agent` binding — it names the bound agent and instructs delegating the stage to that agent unless the caller already is that agent or that agent is unavailable in the runtime; review-kind stages phrase it so the round is performed by the named reviewer agent, not the authoring agent. Null-binding/cross-cutting commands resolve to no stage record and emit no directive (byte-identical output); the seven top-level fields are unchanged. Evidence: src/scripts/lib/delegation.ts, src/scripts/lib/cli.ts (normalizeEnvelope).
- `data.step_help` (current step's title, markdown, commands, exit_criteria) is omitted from authoring envelopes unless the invocation passes `--help-step`; the seven top-level fields are unchanged. Evidence: src/scripts/lib/kinds/authoring.ts.
- `data.metadata` in authoring envelopes mirrors the artifact's metadata object verbatim and contains no step key: artifacts no longer persist one (instantiation and finalization write no step key, the requirements/design/planning stage schemas forbid the property, and a one-time sweep removed the legacy lines), so the envelope's top-level `step` field — recomputed from artifact state on every call — is the single source of truth for step-machine state. The seven top-level fields are unchanged. Evidence: src/scripts/lib/kinds/authoring.ts, src/stages/requirements/schema.yaml.
- `data.semantic_complete` in authoring envelopes is derived from artifact status, not hardcoded: true exactly when the status is `ready-for-review` or `accepted` (reachable only through `--finalize --confirm-semantic`), false for `draft`, `rejected`, and a missing artifact; a post-finalize mutation that resets the status to `draft` reports false again. Evidence: src/scripts/lib/authoring-base.ts (getData).
- Agent descriptors accept an optional `model_override`: a non-empty free-form string, deliberately not constrained by the model catalog enum. `effectiveModel = model_override ?? model` is computed in the registry (AgentRecord.effectiveModel) and written into rendered deploy frontmatter, while the source `model` field stays the enum-checked team recommendation. Evidence: src/schemas/agent.schema.yaml, src/scripts/lib/agent-registry.ts, src/scripts/lib/deploy/platforms/opencode.ts.
- `data.workflows[]` and `data.pipeline` stage entries additionally surface `model` (recommended) and `effectiveModel` (model_override ?? model) for bound agents, alongside the unchanged `agent` binding id; unbound/cross-cutting entries omit both. Evidence: src/scripts/workflows/index.ts, src/scripts/workflows/status.ts.
- Resolution-failure envelopes for a missing `docs/changes` directory name the resolved project root as the searched location — `docs/changes does not exist under <root> (searched: <root>/docs/changes). Run from the project root or pass the root explicitly with --cwd <project-root>.` — replacing the former create-a-change-first instruction; the searched path rides the existing `data.searched` field (also carried by `requireChangeRoot`'s missing-`--change` branch and doctor's failed `change_name` check) instead of new envelope surface, and the seven top-level fields are unchanged. Evidence: src/scripts/lib/resolve-root.ts (changesDirFor, resolveRootOrError), src/scripts/lib/change-root.ts (requireChangeRoot), src/scripts/workflows/doctor.ts.

## Internal APIs

| Function | Purpose | Source File |
|----------|---------|-------------|
| loadAgentRegistry(cwd) | scans src/agents/ for YAML, validates each against agent.schema.yaml, returns the cached AgentRecords exposing model, modelOverride (string \| null), and effectiveModel (model_override ?? model); throws naming the offending file | src/scripts/lib/agent-registry.ts |
| checkAgentCompatibility(stages, agents) | verifies every stage-to-agent binding (floors allow, ceilings deny, multi-binding union of floors / intersection of ceilings); deterministic | src/scripts/lib/agent-permissions.ts |
| getRenderer(platform, version?) | resolves platform + version to a renderer; latest is the default; throws PLATFORM_UNKNOWN listing supported platforms/versions | src/scripts/lib/deploy/platforms/index.ts |
| renderAgent(renderer, agent) | renders one neutral agent definition into the platform's native format (target-relative path + full content) | src/scripts/lib/deploy/platforms/ |

## Schema Reconciliation

| Schema File | Endpoints Covered | Drift |
|-------------|-------------------|-------|
| src/schemas/cli-envelope.schema.yaml | all sdlc CLI envelopes | No |
| src/schemas/stage.schema.yaml | stage.yaml descriptors (startup validation) | No |
| src/schemas/agent.schema.yaml | agent.yaml definitions (startup validation; model enum-checked, model_override free-form) | No |
| src/schemas/docs-delta.schema.yaml | docs-delta.yaml artifact written by knowledge-extraction | No |