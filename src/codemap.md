# src/

## Responsibility
Source tree of the agentic SDLC toolkit: the CLI engine ([scripts/](scripts/codemap.md)),
the stage configuration that is the structural source of truth
([stages/](stages/codemap.md)), and the YAML asset layer — `schemas/`,
`policies/`, `templates/` — that the engine loads and enforces at runtime and
that gets bundled into the deployed skill.

## Directory Layout
| Directory | Role | Map |
|---|---|---|
| `scripts/` | sdlc CLI: entry point, lib engine, kind interpreters, workflows | [scripts/codemap.md](scripts/codemap.md) |
| `stages/` | One folder per stage — the structural source of truth (discovered by directory scan) | [stages/codemap.md](stages/codemap.md) |
| `agents/` | One `<agent-id>.yaml` per neutral agent definition (discovered by scan, validated by `schemas/agent.schema.yaml`) | documented here |
| `schemas/` | JSON Schema contracts: stage + agent meta-schemas, CLI envelope, docs delta | documented here |
| `policies/` | The only central policy file: error code → message/fix catalog | documented here |
| `templates/` | `docs-current-index.md` — the living-docs index template | documented here |

## Design Patterns
- **JSON Schema as declarative contract** (draft-07, all compiled by Ajv with
  `allErrors: true, strict: false`):
  - `schemas/stage.schema.yaml` — the **engine-owned meta-schema** for every
    `stage.yaml` descriptor: required `version` (const 1), `id`
    (`^[a-z0-9-]+$`), `kind` (enum authoring/review/tasks/aggregator),
    `title`, `artifact` (must end `.yaml`), `status_field`; optional
    `requires`, `reviews`, `review_file`, `next_ids`, `produces_delta`,
    `delta_phase`, `title_prefix`, `title_default`; `additionalProperties:
    false`; conditional requirement — `kind: review` ⇒ `reviews` +
    `review_file` required. Enforced at startup by
    `loadStageFolder` → `validateWithSchema(descriptor,
    'stage.schema.yaml', cwd)` (`scripts/lib/schema.ts:33`, compiled and
    cached by `loadSchema`, `schema.ts:19`).
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
- **Single central policy**: `policies/errors.yaml` is the only central
  policy (everything else moved into per-stage folders, DEC-011). A flat
  `errors` map of code → `{message, fix}` (~50 codes: change-dir
  `MISSING_CHANGE_DIR`/`AMBIGUOUS_CHANGE_DIR`/`CHANGE_DIR_NOT_FOUND`,
  artifact `ARTIFACT_NOT_FOUND`/`ARTIFACT_PARSE_FAILED`/`ARTIFACT_INITIALIZED`,
  review `CANNOT_ACCEPT`/`REVIEW_NOT_PASSING`/`CONFLICTING_DECISION`,
  lifecycle `ILLEGAL_STATUS_TRANSITION`/`STAGE_GATE_BLOCKED`,
  task-machine `PLAN_NOT_FOUND`/`TASK_NOT_FOUND`/`INVALID_TASK_STATUS`/
  `MISSING_TASK_UPDATE_FIELDS`, knowledge-extraction
  `IMPLEMENTATION_NOT_ACCEPTED`/`DOCS_INDEX_MISSING`/`DOCS_INDEX_EXISTS`/
  `MISSING_EXTRACTION_NOTE`/`MISSING_MARK_TARGET`/`ENTRY_ID_NOT_FOUND`/
  `TARGET_DOC_NOT_FOUND`, stage discovery `STAGE_MISSING_DESCRIPTOR`/
  `STAGE_INVALID_DESCRIPTOR`/`STAGE_UNKNOWN_KIND`/`STAGE_ID_MISMATCH`/
  `STAGE_CYCLE`/`STAGE_MISSING_REFERENCE`, checks `CHECK_UNKNOWN`/
  `CHECK_INVALID_PARAMS`, runtime `NODE_VERSION_UNSUPPORTED`/
  `MANIFEST_INVALID`/`SCHEMAS_MISSING`/`POLICIES_MISSING`/
  `TEMPLATES_MISSING`, misc `USAGE`/`UNKNOWN_COMMAND`/`UNKNOWN_STAGE`/
  `UNKNOWN_STEP`/`INTERNAL_ERROR`). Loaded through `loadErrorCatalog`
  (`scripts/lib/policy-loader.ts:21`, per-path cache) and rendered by
  `makeError(code, details)` (`scripts/lib/error-catalog.ts:3`), which lets
  call-site details override the catalog message/fix.
- **Template validation**: `templates/docs-current-index.md` is the seed
  table (`| File | Purpose | When to Read | Notes |`) for
  `docs/current/index.md`; `bin/validate-templates.ts` asserts the header row
  exists, and `runDocsInit` (`scripts/workflows/docs-init.ts:71`) uses it as
  the index template (falling back to a built-in default) when bootstrapping
  a project's living docs.

## Data & Control Flow
1. **Startup**: `loadStageRegistry` validates each stage folder's
   `stage.yaml` against `schemas/stage.schema.yaml` (via `validateWithSchema`)
   — a malformed descriptor is a hard startup error naming the folder.
2. **Every CLI response**: built by `writeJson` → `normalizeEnvelope`, which
   enforces the `cli-envelope.schema.yaml` shape (invariant §2.8).
3. **Artifact validation**: each stage's own `schema.yaml` (in `stages/`) is
   compiled by `validateArtifact` (`scripts/lib/validate.ts:23`); the three
   schemas in this directory are cross-cutting contracts, not per-artifact
   schemas.
4. **Knowledge extraction terminal state**: `docs-delta.yaml` written by the
   aggregator conforms to `docs-delta.schema.yaml`.
5. **Error rendering**: any `makeError(code)` call resolves message/fix from
   `policies/errors.yaml` at runtime.
6. **Doctor**: `runDoctor` verifies the runtime asset dirs exist
   (`schemas`/`policies`/`templates`/`stages`) and that
   `cli-envelope.schema.yaml` is present.

## Integration
- **Consumed by**: `scripts/lib/schema.ts` + `scripts/lib/policy-loader.ts`
  (loaders), `bin/validate-schemas.ts` (compiles every `schemas/*.yaml`),
  `bin/validate-policies.ts` (validates `errors.yaml` shape + stage folders
  against the meta-schema), `bin/validate-templates.ts` (index template
  header), `scripts/workflows/doctor.ts` (runtime asset checks).
- **Bundled**: `bin/deploy-to-agent.ts` copies `schemas/`, `policies/`,
  `templates/` verbatim into the deployed skill at
  `.opencode/skills/agentic-sdlc/` (build artifact, produced alongside the
  tsup bundle; see [scripts/codemap.md](scripts/codemap.md)).
- **Depends on**: nothing — leaf assets.