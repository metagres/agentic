# src/scripts/lib/

## Responsibility
The engine core of the sdlc CLI: stage discovery from `src/stages/` folder
scans, the requires-DAG and acceptance-gate evaluation, the unified artifact
validation orchestrator, the declarative step machine, and the shared plumbing
(envelope emission, change-dir resolution, policy/schema loading, ID and path
utilities). Everything above this directory (the CLI entry, kind interpreters,
workflows, and the `bin/` tools) composes these modules; nothing here reads
hardcoded stage lists.

## Design Patterns
- **Directory-based discovery (invariant §2.10)**: `loadStageRegistry(cwd, stagesDir?)`
  (`stage-registry.ts:176`) scans `resolveStagesDir(cwd)` (`paths.ts:39`), sorts
  folders alphabetically, and builds a cached `StageRecord[]` via
  `loadStageFolder` (`stage-registry.ts:98`). Each folder must carry a `stage.yaml`
  that (a) validates against the engine meta-schema `stage.schema.yaml` via
  `validateWithSchema` (`schema.ts:33`), (b) has `id` equal to the folder name, and
  (c) declares a known `kind`. `KIND_FILE_SETS` (`stage-registry.ts:48`) enforces the
  canonical per-kind file set (CMP-009); a missing required file is a hard startup
  error naming the folder. `getStageById` (`:202`) and `getStageDescriptions` (`:211`)
  are the registry accessors; `loadStageHooks` (`:228`) dynamically imports the
  optional `hooks.js`/`hooks.ts` (the only stage-specific code allowed, never part
  of validation), and `stagePreconditionWarnings` (`:251`) invokes its
  `preconditionWarnings(env)` export.
- **DAG + gate over the registry**: `requires-graph.ts` implements the pipeline
  order and the acceptance gate. `computePipelineOrder(cwd, stagesDir?)`
  (`requires-graph.ts:71`) is Kahn's algorithm over `requires` with an alphabetical
  tie-break; a missing reference throws `Stage '<id>' requires unknown stage
  '<req>'` and a residual set throws a cycle error found by `findCycle` (`:24`,
  white/gray/black DFS). `evaluateGate(stage, changeRoot, cwd, stagesDir?)`
  (`:147`) reads each required stage's tracked artifact status
  (`readTrackedStatus`, `:129` — `metadata.<status_field>` of the artifact file,
  `'missing'` when absent) and enforces DEC-008: non-review stages need every
  requirement `accepted` (a review requirement's tracked artifact is the artifact
  of the stage it `reviews`); review stages are runnable when their review target's
  artifact is `ready-for-review` or `accepted`. Unsatisfied requirements are
  returned as `GateResult.unsatisfied[]` with `{stage, artifact, status, required}`.
- **Single validation path (CMP-005)**: `validateArtifact(stageId, artifact, cwd,
  changeRoot)` (`validate.ts:59`) concatenates JSON Schema findings from the
  stage's `schema.yaml` (compiled and cached by Ajv with `allErrors`, `strict:
  false`, optional `ajv-formats`) with the named structural checks from the
  stage's `structural-checks.yaml` via `runStageChecks` (checks sub-library).
  The frozen `Finding` shape is `{check, severity, category, target, finding,
  fix?}` (`types.ts:18`).
- **Declarative step predicates (DM-003)**: `steps-loader.ts` loads
  `steps.yaml` (`loadStepDefinitions`, `:80`; cached per folder via
  `getStepDefinitions`, `:96`) and evaluates the `complete_when` vocabulary —
  `field` + `non_empty`/`equals` (dotted-path resolution via `resolveDotPath`),
  `array` + `min_items`, and `all`/`any` combinators — in
  `evaluatePredicate` (`:43`); a missing predicate means complete.
- **Generic authoring step machine (FLW-002)**: `authoring-base.ts` defines
  `CANONICAL_STEPS` (`:10`: needs_input, init, authoring, ready, complete,
  recovery — the six-step tour every authoring stage declares in steps.yaml)
  and `detectStep(env)` (`:55`), detected purely from artifact state — never
  from stage hooks: no change dir → `needs_input`; no artifact → `init`;
  `metadata.status === 'rejected'` → `recovery`; unsatisfied `init`
  predicate → `init`; blocking mechanical findings → `recovery`; then any
  non-canonical steps.yaml step whose `complete_when` predicate is
  unsatisfied; `complete` when status is `ready-for-review`/`accepted`, else
  `ready` when the `authoring` predicate is satisfied and `authoring` while
  still drafting. `isReadyForReview` (`:79`) and `getData` (`:107`) expose
  the same signals (`authoring_complete`, `mechanical_valid`,
  `semantic_complete`, `delta_complete`; `deltaComplete` in
  `stage-helpers.ts:5` accepts a non-empty `delta` array or
  `metadata.delta_reviewed === true`).
- **Frozen envelope + exit codes**: `cli.ts` — `EXIT` (`:3`), `parseArgs` (`:11`),
  `normalizeEnvelope` (`:43`) and `writeJson` (`:105`) (see
  [../codemap.md](../codemap.md) for the full contract).
- **Change-dir resolution**: `resolve-root.ts` `resolveRootOrError` (`:56`) —
  the `cwd` is the project root (the agent always invokes the CLI from the
  folder where it started; the CLI script's own location — which may be a
  global skill dir — is never used to infer it). Explicit paths (with a
  refuse-outside-repo guard unless `allowExternal`), then slug lookup under
  `docs/changes/` via a matching cascade: case-insensitive exact → normalized
  exact → token subset (every input token must appear in the entry's
  normalized tokens) → normalized substring; a unique match resolves, multiple
  matches throw `ResolveRootError` with `candidates`, zero matches is
  not-found. Failures also carry `available` (sorted change-dir names, `[]`
  when the dir is missing) and `searched` (the `docs/changes` path).
  `change-root.ts` `requireChangeRoot(args, cwd, base)` (`:31`) wraps this into
  blocked envelopes: `MISSING_CHANGE_DIR`, `AMBIGUOUS_CHANGE_DIR` (exit
  `EXIT.ambiguous` 3), `CHANGE_DIR_NOT_FOUND`; these surface
  `data.available_changes`, `data.searched` and a contextual `fix` on the
  error item.
- **Context abstraction**: `context.ts` `makeCtx(cwd, changeRoot)` (`:18`) returns
  `Ctx` (`types.ts:49`) with `loadFile`/`fileExists`/`readFile` resolving
  change-root-first then cwd, plus `safeReadYaml` (`:10`) and
  `loadReviewReport` (`:60`, reads `review-report.yaml`).
- **Central policy loading**: `policy-loader.ts` `loadErrorCatalog(cwd)` (`:21`)
  loads the only central policy (`policies/errors.yaml`) through
  `resolveRuntimeFile` with a per-path cache; `error-catalog.ts` `makeError(code,
  details)` (`:3`) renders `{code, message, fix?, ...details}` from the catalog
  (falling back to the code itself when the catalog is unavailable).
- **Runtime path resolution**: `paths.ts` `resolveRuntimeFile`/
  `resolveRuntimeDir` (`:7`/`:24`) try script-relative (repo: `src/<dir>`;
  deployed bundle: sibling `<dir>` next to the CLI) then cwd-relative candidates —
  this is how the same code runs from `src/scripts/` in the repo and from
  `scripts/sdlc.js` in the deployed skill.
- **Utilities**: `ids.ts` — `nextId(existingIds, prefix)` (max+1, zero-padded to
  3), `nextIdsFromArrays(artifact, specs)`, `today()`, `nowIso()`, `slugify`
  (word-boundary truncation: whole words dropped to fit the 60-char budget,
  never mid-word, no trailing hyphen),
  `uniqueSlug`; `stage-helpers.ts` — `deltaComplete`, `titleFromRequest` (80-char
  truncation), `baseVersion`; `semver.ts` `bumpVersion`; `yaml-io.ts` —
  `readYaml` (null when missing, throwing on bad YAML), `writeYamlAtomic`
  (tmp-file + rename), `readStdin`, `parseYamlString`; `docs-index.ts` —
  `loadDocsIndex`/`parseDocsIndex` (markdown table under `docs/current/`;
  accepts bare filenames and prefixed paths, filters non-`.md` noise rows so
  delta target/anchor validation runs against real docs),
  `headingExists`/`normalizeHeading`; `version.ts` — `VERSION = '1.0.0'`;
  `types.ts` — shared interfaces (`Finding`, `ErrorItem`, `WarningItem`,
  `SemanticSummary`, `StageRecord` consumers, `RunEnv`, `WorkflowDef`,
  `ChangeEntry`); `runner.ts` — `runAuthoringStage` (`:12`), the registry→kind
  dispatch entry for stage commands.

## Data & Control Flow
Validation pipeline as executed by `validateArtifact` (and thus by authoring
`--finalize`, review stages, and `bin/lint-artifact.ts` — identical findings):
1. Resolve the stage via `getStageById` (registry scan + meta-schema validation).
2. YAML parse layer is the caller's responsibility (artifact already parsed via
   `readYaml`); a null/non-object artifact yields no findings.
3. JSON Schema layer: `schemaFindings` (`validate.ts:23`) runs the stage
   `schema.yaml` through cached Ajv; failures become blocking `schema` findings.
4. Structural layer: `runStageChecks` runs the named checks declared in the
   stage's `structural-checks.yaml` (see [checks/](checks/codemap.md)).
5. Semantic advisory: the kind interpreter separately evaluates the stage's
   `semantic-checks.yaml` and folds the `SemanticSummary` into the envelope
   (see [kinds/](kinds/codemap.md)).
6. Review gate: `evaluateGate` (above) decides runnability before any of the
   above runs for a stage command; failure produces a blocked envelope naming
   each unsatisfied requirement and its current status.

Stage-run path: `sdlc.ts` → `resolveWorkflow` → `runStage(stage, argv, cwd)`
(kinds dispatcher) → `parseArgs` → `requireChangeRoot` (when `--change` is
required) → `getStageById`/`loadStepDefinitions`/`loadStageHooks` →
`makeCtx(cwd, changeRoot)` → artifact read via `ctx.loadFile` →
`validateArtifact` + semantic evaluation → `detectStep`/kind transition →
`writeJson` envelope.

## Integration
- **Consumed by**: `src/scripts/sdlc.ts` (envelope, registry),
  [kinds/](kinds/codemap.md) (step machine, gate, validation, context),
  [workflows/](workflows/codemap.md) (registry, pipeline order, docs index),
  `bin/lint-artifact.ts`, `bin/validate-policies.ts`, `bin/deploy-to-agent.ts`.
- **Depends on**: [../stages/](../stages/codemap.md) folders discovered at
  runtime (descriptors + config files), `src/schemas/stage.schema.yaml`
  (meta-schema), `src/policies/errors.yaml` (error catalog), sub-libraries
  [checks/](checks/codemap.md) and [kinds/](kinds/codemap.md); npm deps `ajv`,
  `ajv-formats`, `yaml`.