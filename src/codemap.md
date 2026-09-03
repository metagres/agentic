# src/

## Responsibility
Source tree of the agentic SDLC toolkit: the CLI engine ([scripts/](scripts/codemap.md)),
the stage configuration that is the structural source of truth
([stages/](stages/codemap.md)), the neutral agent layer (`agents/` — six `<agent-id>.yaml` definitions,
discovered by directory scan; deliberately no sub-codemap, covered here),
the dev-only maintenance skills (`skills/` — `agent-audit` and
`improvement-review`), and the YAML asset layer — `schemas/`, `policies/`, `templates/` — that the
engine loads and enforces at runtime and that gets bundled into the deployed
skill.

## Directory Layout
| Directory | Role | Map |
|---|---|---|
| `scripts/` | sdlc CLI: entry point, lib engine, kind interpreters, workflows | [scripts/codemap.md](scripts/codemap.md) |
| `stages/` | One folder per stage — the structural source of truth (discovered by directory scan) | [stages/codemap.md](stages/codemap.md) |
| `agents/` | One `<agent-id>.yaml` per neutral agent definition (six shipped; discovered by scan, validated by `schemas/agent.schema.yaml`); deliberately no sub-codemap | documented here |
| `schemas/` | JSON Schema contracts: stage + agent meta-schemas, CLI envelope, docs delta | documented here |
| `policies/` | The only central policy file: error code → message/fix catalog | documented here |
| `templates/` | `docs-current-index.md` — the living-docs index template | documented here |
| `skills/` | Development-only maintenance skills (`agent-audit`, `improvement-review`); never deployed | documented here |

## Design Patterns
- **JSON Schema as declarative contract** (draft-07, all compiled by Ajv with
  `allErrors: true, strict: false`):
  - `schemas/stage.schema.yaml` — the **engine-owned meta-schema** for every
    `stage.yaml` descriptor: required `version` (const 1), `id`
    (`^[a-z0-9-]+$`), `kind` (enum authoring/review/tasks/aggregator),
    `title`, `artifact` (must end `.yaml`), `status_field`; optional
    `requires`, `reviews`, `review_file`, `next_ids` (each value a string or a
    non-empty string list of path selectors, DEC-004), `produces_delta`,
    `delta_phase`, `title_prefix`, `title_default`, `agent`,
    `permissions`; `additionalProperties: false`; conditional
    requirements — `kind: review` ⇒ `reviews` + `review_file` required;
    `agent` present ⇒ `permissions` must also be present and use the neutral
    `allow`/`deny` vocabulary. Enforced at startup by
    `loadStageFolder` → `validateWithSchema(descriptor,
    'stage.schema.yaml', cwd)` (`scripts/lib/schema.ts:33`, compiled and
    cached by `loadSchema`, `schema.ts:19`).
  - `schemas/agent.schema.yaml` — the **engine-owned meta-schema** for every
    `<agent-id>.yaml` (DEC-001): required `version` (const 1), `id`
    (`^[a-z0-9-]+$`), `description`, `model` (enum — the current model
    catalog), `temperature` (0–1), `permissions` (the seven neutral keys
    `file_read`, `search`, `file_write`, `shell`, `subagent`, `web`,
    `question`, each `allow`/`ask`/`deny`), `system_prompt`; optional
    `model_override` (non-empty free-form string, deliberately not
    enum-checked — DEC-003) and `mode` (subagent/primary/all);
    `additionalProperties: false`. Enforced at startup by
    `loadAgentRegistry` (`scripts/lib/agent-registry.ts`) via
    `validateWithSchema(record, 'agent.schema.yaml', cwd)`.
  - `schemas/cli-envelope.schema.yaml` — the **frozen envelope** (invariant
    §2.8): exactly `workflow`, `step`, `state` (enum ok/in_progress/blocked/
    complete), `instructions`, `data`, `errors`, `warnings`;
    `additionalProperties: false`. The runtime enforces the same shape in
    `normalizeEnvelope` (`scripts/lib/cli.ts:43`); this schema is the
    reference contract that `doctor` checks for
    (`cli_envelope_schema` check).
  - `schemas/docs-delta.schema.yaml` — the `docs-delta.yaml` terminal
    artifact: `metadata{stage, status (enum `complete`), updated
    (YYYY-MM-DD), change_root}` + `deltas_applied` (integer ≥ 0), no extra
    properties.
- **The neutral agent layer (DEC-001, DEC-003, DEC-004)**:
  - `agents/<agent-id>.yaml` — six shipped, discovered by directory scan
    (no central enumeration): `implementation-engineer`, `knowledge-curator`,
    `requirements-analyst`, `stage-reviewer`, `systems-architect`,
    `task-planner`. Stages bind to them optionally through
    `stage.yaml: agent`; binding is validated by
    `checkAgentCompatibility` (`scripts/lib/agent-permissions.ts:174`,
    pure) against the kind contract for the bound stage
    (`KIND_PERMISSION_CONTRACTS`, `agent-permissions.ts:43`) and the
    aggregate floor/ceiling requirements across that agent's bindings;
    findings are `AGENT_REF_UNRESOLVED` /
    `AGENT_PERMISSION_INCOMPATIBLE` (TASK-007).
  - `scripts/lib/agent-registry.ts` — `loadAgentRegistry` (discovers
    `src/agents/*.yaml`, compiles each descriptor against
    `agent.schema.yaml`, surfaces `effectiveModel = model_override ?? model`
    plus `modelOverride` separately for deploy), `getAgentById`,
    `getAgentModelFields`.
  - `scripts/lib/agent-permissions.ts` — kind permission contracts
    (one neutral profile per `StageKind` with `allow` floors and `deny`
    ceilings), `computeEffectivePermissions` (folds descriptor
    `permissions` overrides onto the kind contract), and the
    `checkAgentCompatibility` static analysis.
  - `scripts/lib/agent-prompt-marker.ts` — system-prompt purity markers
    (the vocabulary of forbidden CLI/skill/envelope phrases);
    `findPromptMarkers` is the deterministic, case-insensitive scanner
    used by `bin/validate-policies.ts` and surfaces
    `AGENT_PROMPT_MARKER`.
  - `scripts/lib/agent-model-fields.ts` — `checkAgentModelFields`:
    `model_override` must be non-empty when present, `model` must be a
    member of the current catalog enum (DEC-003, NFR-002);
    `AGENT_MODEL_OVERRIDE_EMPTY` / `AGENT_MODEL_OUTSIDE_CATALOG`.
  - `scripts/lib/delegation.ts` — `delegationDirective(stage)` (DM-003):
    pure composer that builds the delegation directive from `StageRecord`
    fields only; a null binding yields null, a non-null binding yields a
    directive naming the bound agent and a self/unavailability clause;
    `kind: review` produces the reviewer-directed variant. No hardcoded
    agent ids.
  - `scripts/lib/review-findings.ts` — reviewer findings-file parser
    and `^[A-Z]{2,6}-[0-9]{2,4}$` target resolver (DM-004, DEC-001);
    unknown `target` ids produce `FINDINGS_ID_NOT_FOUND`-class findings
    so a reviewer can never silently re-target an id that the engine
    does not recognise.
  - **Deployment renderers** under `scripts/lib/deploy/platforms/`
    (TASK-009) — the **only** place coding-agent-specific knowledge is
    allowed (the engine is otherwise agent-agnostic). `index.ts`
    registers renderers keyed by `(platform, version)`; `opencode.ts`
    renders neutral `AgentRecord` into `.opencode/agents/<id>.md`,
    supporting two frontmatter format versions (v1 `tools` map, v2
    `permission` map) and translating the neutral permission vocabulary
    verbatim. Invoked by `bin/deploy-to-agent.ts`; output lands in
    `.opencode/` (build artifact, gitignored).
- **Single central policy**: `policies/errors.yaml` is the only central
  policy (everything else moved into per-stage folders, DEC-011). A flat
  `errors` map of code → `{message, fix}` (now ~55 codes: change-dir
  `MISSING_CHANGE_DIR`/`AMBIGUOUS_CHANGE_DIR`/`CHANGE_DIR_NOT_FOUND`,
  artifact `ARTIFACT_NOT_FOUND`/`ARTIFACT_PARSE_FAILED`/`ARTIFACT_INITIALIZED`,
  review `CANNOT_ACCEPT`/`REVIEW_NOT_PASSING`/`CONFLICTING_DECISION`,
  lifecycle `ILLEGAL_STATUS_TRANSITION`/`STAGE_GATE_BLOCKED`,
   task-machine `PLAN_NOT_FOUND`/`TASK_NOT_FOUND`/`INVALID_TASK_STATUS`/
   `MISSING_TASK_UPDATE_FIELDS`/`TASK_DONE_REQUIRES_NOTE`, knowledge-extraction
  `IMPLEMENTATION_NOT_ACCEPTED`/`DOCS_INDEX_MISSING`/`DOCS_INDEX_EXISTS`/
  `MISSING_EXTRACTION_NOTE`/`MISSING_MARK_TARGET`/`ENTRY_ID_NOT_FOUND`/
  `TARGET_DOC_NOT_FOUND`, stage discovery `STAGE_MISSING_DESCRIPTOR`/
  `STAGE_INVALID_DESCRIPTOR`/`STAGE_UNKNOWN_KIND`/`STAGE_ID_MISMATCH`/
  `STAGE_CYCLE`/`STAGE_MISSING_REFERENCE`, checks `CHECK_UNKNOWN`/
  `CHECK_INVALID_PARAMS`, agent `AGENT_PROMPT_MARKER`/
  `AGENT_REF_UNRESOLVED`/`AGENT_PERMISSION_INCOMPATIBLE`/
  `AGENT_MODEL_OVERRIDE_EMPTY`/`AGENT_MODEL_OUTSIDE_CATALOG`, runtime
  `NODE_VERSION_UNSUPPORTED`/`MANIFEST_INVALID`/`SCHEMAS_MISSING`/
  `POLICIES_MISSING`/`TEMPLATES_MISSING`, misc `USAGE`/`UNKNOWN_COMMAND`/
  `UNKNOWN_STAGE`/`UNKNOWN_STEP`/`INTERNAL_ERROR`). Loaded through
  `loadErrorCatalog` (`scripts/lib/policy-loader.ts:21`, per-path cache) and
  rendered by `makeError(code, details)` (`scripts/lib/error-catalog.ts:3`),
  which lets call-site details override the catalog message/fix.
- **Template validation**: `templates/docs-current-index.md` is the seed
  table (`| File | Purpose | When to Read | Notes |`) for
  `docs/current/index.md`; `bin/validate-templates.ts` asserts the header row
  exists, and `runDocsInit` (`scripts/workflows/docs-init.ts:71`) uses it as
  the index template (falling back to a built-in default) when bootstrapping
  a project's living docs.
- **Dev-only maintenance skills (under `src/skills/`)** — never bundled
  or deployed; invoked manually by the maintainer:
  - `skills/agent-audit/` — refreshes the model catalog enum from the live
    opencode endpoint, reassigns each agent's LLM with web-grounded
    justification (never overwriting an existing `model_override`),
    realigns parameters and permissions with stage purpose, and
    dedupes/adds/removes agents with `stage.yaml` rebinding.
  - `skills/improvement-review/` — re-runs the six-step SDLC improvement
    review against live dogfooding evidence. Pure advisor: reads the
    goals canon (`docs/current/capabilities.md` `## SDLC Goals`) and
    baselines (`docs/current/operations.md` `## Baselines`) read-only
    and writes only `docs/ideas/` proposals. The first dev-only skill
    to bundle scripts — four deterministic TypeScript helpers under
    `skills/improvement-review/scripts/` (`envelope_sizes.ts`,
    `measure_artifacts.ts`, `mine_transcript.ts`,
    `validate_duration.ts`) for instrumentation and measurement.

## Data & Control Flow
1. **Startup**: `loadStageRegistry` validates each stage folder's
   `stage.yaml` against `schemas/stage.schema.yaml`; `loadAgentRegistry`
   validates each `agents/<id>.yaml` against
   `schemas/agent.schema.yaml` — both via `validateWithSchema`; a
   malformed descriptor is a hard startup error naming the folder.
   `bin/validate-policies.ts` then runs the agent-layer cross-checks
   (`checkAgentModelFields`, prompt-marker scan, `checkAgentCompatibility`)
   and the per-stage structural-checks declarations.
2. **Every CLI response**: built by `writeJson` → `normalizeEnvelope`, which
   enforces the `cli-envelope.schema.yaml` shape (invariant §2.8).
3. **Delegation directive**: when a stage is invoked, the kind interpreter
   consults `delegationDirective(stage)`; a non-null binding surfaces an
   `instructions` directive naming the bound agent (or a reviewer-directed
   variant for `kind: review`) so the caller knows whether to delegate.
4. **Artifact validation**: each stage's own `schema.yaml` (in `stages/`) is
   compiled by `validateArtifact` (`scripts/lib/validate.ts:23`); the four
   schemas in this directory are cross-cutting contracts, not per-artifact
   schemas.
5. **Knowledge extraction terminal state**: `docs-delta.yaml` written by the
   aggregator conforms to `docs-delta.schema.yaml`.
6. **Error rendering**: any `makeError(code)` call resolves message/fix from
   `policies/errors.yaml` at runtime.
7. **Doctor**: `runDoctor` verifies the runtime asset dirs exist
   (`schemas`/`policies`/`templates`/`stages`) and that
   `cli-envelope.schema.yaml` is present.
8. **Deployment**: `bin/deploy-to-agent.ts` resolves a renderer from
   `deploy/platforms/index.ts` (currently OpenCode v1 + v2), renders every
   `AgentRecord` to `.opencode/agents/<id>.md`, bundles the engine, and
   produces the two deployed skills under
   `.opencode/skills/agentic-sdlc/` and `.opencode/skills/knowledge-init/`.
   The dev-only skills under `src/skills/` are NOT deployed.

## Integration
- **Consumed by**: `scripts/lib/schema.ts` + `scripts/lib/policy-loader.ts`
  (loaders), `bin/validate-schemas.ts` (compiles every `schemas/*.yaml`),
  `bin/validate-policies.ts` (validates `errors.yaml` shape + stage folders
  against the meta-schema + agent-layer cross-checks),
  `bin/validate-templates.ts` (index template header),
  `scripts/workflows/doctor.ts` (runtime asset checks).
- **Bundled**: `bin/deploy-to-agent.ts` copies `schemas/`, `policies/`,
  `templates/` verbatim into the deployed skill at
  `.opencode/skills/agentic-sdlc/` (build artifact, produced alongside the
  tsup bundle; see [scripts/codemap.md](scripts/codemap.md)). Agent
  renderers under `scripts/lib/deploy/platforms/` produce
  `.opencode/agents/<id>.md` from the neutral `src/agents/*.yaml`.
- **Depends on**: nothing — leaf assets.
