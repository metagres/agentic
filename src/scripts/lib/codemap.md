# src/scripts/lib/

## Responsibility
The engine core of the sdlc CLI: stage discovery from `src/stages/` folder
scans, parallel agent discovery from `src/agents/`, the requires-DAG and
acceptance-gate evaluation, the unified artifact validation orchestrator, the
declarative step machine, the deployment-layer platform renderers, and the
shared plumbing (envelope emission, change-dir resolution, policy/schema
loading, ID and path utilities, permission contract compatibility, prompt
purity markers, review findings parsing). Everything above this directory (the
CLI entry, kind interpreters, workflows, and the `bin/` tools) composes these
modules; nothing here reads hardcoded stage or agent lists.

## Design Patterns
- **Directory-based discovery (invariant §2.10)**: `loadStageRegistry(cwd, stagesDir?)`
  (`stage-registry.ts:207`) scans `resolveStagesDir(cwd)` (`paths.ts:39`), sorts
  folders alphabetically, and builds a cached `StageRecord[]` via
  `loadStageFolder` (`stage-registry.ts:125`). Each folder must carry a `stage.yaml`
  that (a) validates against the engine meta-schema `stage.schema.yaml` via
  `validateWithSchema` (`schema.ts:33`), (b) has `id` equal to the folder name, and
  (c) declares a known `kind`. `KIND_FILE_SETS` (`stage-registry.ts:52`) enforces the
  canonical per-kind file set (CMP-009); a missing required file is a hard startup
  error naming the folder. `schema_from` delegates a stage's artifact contract to
  another stage's `schema.yaml` (declared once by the owning stage); local
  coexistence or a missing target is a hard startup error. `getStageById` (`:233`)
  and `getStageDescriptions` (`:242`) are the registry accessors;
  `loadStageHooks` (`:260`) dynamically imports the optional
  `hooks.js`/`hooks.ts` (the only stage-specific code allowed, never part
  of validation), and `stagePreconditionWarnings` (`:283`) invokes its
  `preconditionWarnings(env)` export.
- **Agent layer (mirror of stage discovery)**: `loadAgentRegistry(cwd, agentsDir?)`
  (`agent-registry.ts:91`) scans `resolveAgentsDir(cwd)` (`paths.ts:46`) the same
  way stages are resolved, builds a cached `AgentRecord[]`, validates each
  descriptor against `agent.schema.yaml`, and enforces that the descriptor `id`
  equals the filename stem. A missing or empty agents directory yields `[]` (not
  an error), so projects without agents keep working. Each `AgentRecord` carries
  the neutral fields (`id`, `file`, `description`, `model`, `modelOverride`,
  `effectiveModel = modelOverride ?? model`, `temperature`, `mode`, `permissions`,
  `systemPrompt`); `getAgentById` (`:117`) is the accessor and
  `getAgentModelFields` (`:132`) returns the `{model, effectiveModel}` pair for
  CLI envelope data entries.
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
  changeRoot)` (`validate.ts:66`) concatenates JSON Schema findings from the
  stage's `schema.yaml` (compiled and cached by Ajv with `allErrors`, `strict:
  false`, optional `ajv-formats`) with the named structural checks from the
  stage's `structural-checks.yaml` via `runStageChecks` (checks sub-library).
  Before the checks run, `validateCheckDeclarations(stage, checksDoc, cwd)`
  (`validate.ts:100`) validates the declarations themselves (CMP-003, DEC-003):
  every `[]`-bearing parameter string must sit inside a path-bearing parameter
  slot of its check (`pathParams` metadata in the catalog) and must resolve
  through the governing stage schema — the stage's own `schema.yaml`, or for
  `ref-exists` `to.file` targets the schema of the stage owning that artifact
  resolved through the registry, with a grammar-only fallback for files no
  stage owns; violations throw naming the stage folder and the declaration.
  The frozen `Finding` shape is `{check, severity, category, target, finding,
  fix?}` (`types.ts:18`).
- **Artifact path resolver (CMP-001, DEC-001)**: `artifact-paths.ts` holds the
  `segment([].segment)*` path grammar and two pure functions —
  `resolveCollections(doc, spec)` (every non-empty array instance a selector
  addresses, with its fully indexed location chain) and `resolveLeafValues(doc,
  spec)` (scalar string values with fully indexed targets such as
  `functional_requirements[0].acceptance_criteria[1].statement`) — plus
  `parsePathSpec` for the declaration validator. A `[]`-marked segment iterates
  the array-valued property it names; a spec without `[]` addresses a top-level
  node; absent properties and empty arrays yield empty results and never error.
  No I/O, no ambient state. Consumers: `checks/shared.ts` (`getTopArray`/
  `resolvePath` delegate, signatures unchanged), `checks/unique-ids.ts`,
  `checks/ref-exists.ts`, `checks/forbidden-words.ts`, and `ids.ts`
  (list-valued `next_ids` specs).
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
  `semantic_complete`, `delta_complete`; `semantic_complete` derives purely
  from artifact status per DEC-002 — `ready-for-review`/`accepted` only;
  `deltaComplete` in `stage-helpers.ts:6` accepts a non-empty `delta` array
  or `metadata.delta_reviewed === true`).
- **Frozen envelope + exit codes**: `cli.ts` — `EXIT` (`:6`: `ok`/`actionFailed`/
  `usage`/`ambiguous`/`internal`), `parseArgs` (`:14`, supports `--key=value` and
  `--key value`), `resolveCwd` (`:49`, `--cwd <project-root>` override
  documented by `CWD_FLAG_DOC` at `:55`), `normalizeEnvelope` (`:58`) and
  `writeJson` (`:144`) (see [../codemap.md](../codemap.md) for the full
  contract). `normalizeEnvelope` resolves the workflow id to a stage record
  via `getStageById(process.cwd(), workflowId, stagesDir)` and prepends
  `delegationDirective(stage)` (CMP-002, DEC-001, DEC-005) ahead of the
  existing instructions as a distinct paragraph when the stage has a
  non-null `agent` binding; cross-cutting/unknown ids stay byte-identical
  (FR-002) and registry resolution failures stay quiet.
- **Delegation directives (CMP-001 / DM-003)**: `delegation.ts`
  `delegationDirective(stage)` (`:21`) is a pure composer over
  `StageRecord.{id, kind, agent}`. A null binding yields `null` (unbound
  stages and cross-cutting commands stay silent, FR-002). A non-null binding
  yields a directive that tells the caller to delegate to the named agent,
  with self and unavailability fallbacks ("if you are already X, proceed
  running the stage yourself" / "if X is not present or not invocable in
  your runtime, proceed running the stage yourself", AC-002/AC-011).
  Review-kind stages get the reviewer-directed variant: the review round
  must be performed by the bound reviewer agent, not the authoring agent
  (FR-003). Text is always interpolated from the binding — no hardcoded
  agent ids or paths (NFR-002).
- **Change-dir resolution**: `resolve-root.ts` `resolveRootOrError` (`:65`) —
  the `cwd` is the project root (the agent always invokes the CLI from the
  folder where it started; the CLI script's own location — which may be a
  global skill dir — is never used to infer it). The changes dir is built
  once by `changesDirFor(cwd)` (`:61`) as `path.join(cwd, 'docs', 'changes')`.
  Explicit paths (with a refuse-outside-repo guard unless `allowExternal`),
  then slug lookup under `docs/changes/` via a matching cascade:
  case-insensitive exact → normalized exact → token subset (every input
  token must appear in the entry's normalized tokens) → normalized
  substring; a unique match resolves, multiple matches throw
  `ResolveRootError` with `candidates`, zero matches is not-found. Failures
  also carry `available` (sorted change-dir names, `[]` when the dir is
  missing) and `searched` (the `docs/changes` path). `change-root.ts`
  `requireChangeRoot(args, cwd, base)` (`:31`) wraps this into blocked
  envelopes: `MISSING_CHANGE_DIR`, `AMBIGUOUS_CHANGE_DIR` (exit
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
  3), `nextIdsFromArrays(artifact, specs)` (a spec value is a string —
  top-level field, byte-identical behavior — or a list of path selectors
  resolved through `artifact-paths.ts` and unioned before `nextId`, DEC-004),
  `today()`, `nowIso()`, `slugify`
  (word-boundary truncation: whole words dropped to fit the 60-char budget,
  never mid-word, no trailing hyphen; a single overlong word is hard-truncated
  as the only way to stay within budget), `validateChangeSlug` (rejects
  non-`[a-z0-9-]`, leading non-alnum, trailing hyphen, oversize), `uniqueSlug`;
  `stage-helpers.ts` — `deltaComplete`, `normalizeDeltaEntries` (API-003: shared
  delta normalization for `--append-delta` and `--update-artifact`, defaulting
  `phase` from the stage and `date` to `today()`), `titleFromRequest`
  (80-char truncation), `baseVersion`; `semver.ts` `bumpVersion`; `yaml-io.ts` —
  `readYaml` (null when missing, throwing on bad YAML), `writeYamlAtomic`
  (tmp-file + rename), `readStdin`, `parseYamlString`; `docs-index.ts` —
  `loadDocsIndex`/`parseDocsIndex` (markdown table under `docs/current/`;
  accepts bare filenames and prefixed paths, filters non-`.md` noise rows so
  delta target/anchor validation runs against real docs),
  `headingExists`/`normalizeHeading`; `version.ts` — `VERSION = '1.0.0'`;
  `types.ts` — shared interfaces (`ParseArgsResult`, `Finding`, `ErrorItem`,
  `WarningItem`, `SemanticResult`, `SemanticSummary`, `StepDefinition`,
  `Ctx`, `StageDef`, `RunEnv`, `WorkflowDef`, `ChangeEntry`); `runner.ts` —
  `runAuthoringStage(stageId, argv)` (`:10`), the registry→kind dispatch entry
  for stage commands: resolves `getStageById(cwd, stageId)`, emits
  `UNKNOWN_STAGE` blocked envelope on miss, otherwise delegates to
  `kinds/index.ts` `runStage`.
- **Kind permission contracts & compatibility (CMP-003 / DEC-005 / DM-002)**:
  `agent-permissions.ts` is pure (no I/O, no LLM, runtime-agnostic) and pins
  each stage kind to a neutral permission profile (`KIND_PERMISSION_CONTRACTS`,
  `:43` — six keys: `file_read`, `search`, `file_write`, `shell`, `subagent`,
  `web`; `question` is also accepted in agent declarations but takes no part
  in contracts). `'allow'` is a floor (agent MUST declare `allow`),
  `'deny'` is a ceiling (agent MUST declare `deny`), absent keys are
  unconstrained. `computeEffectivePermissions(stage)` (`:104`) folds the
  descriptor's optional `permissions` overrides into the kind contract;
  values outside `allow`/`deny` or keys outside the neutral six are ignored
  so a misspelled override can never weaken a contract. `checkAgentCompatibility(
  stages, agents)` (`:174`) verifies every stage→agent binding: an
  unresolvable agent id yields one `PermissionFinding` per binding with
  empty `key` and `required: 'resolvable'`; an incompatible agent produces
  one finding per key (floor or ceiling violation, sorted by
  `stage, agent, key, conflict_with`); two bindings of the same agent
  requiring opposite levels for the same key are reported as a
  `conflict_with` finding (the key is not additionally reported as an
  ordinary violation).
- **Prompt purity markers (TASK-007)**: `agent-prompt-marker.ts` —
  `PROMPT_MARKERS` (`:18`) is the vocabulary that must never appear in an
  agent `system_prompt`: CLI flags (`--change`, `--request`,
  `--update-artifact`, `--append-delta`, `--complete-step`, `--finalize`,
  `--confirm-semantic`, `--record-answer`, `--set-clarity`, `--next-ids`,
  `--accept`, `--reject`, `--task-id`), the script path (`scripts/sdlc.js`),
  the bare token `sdlc`, and envelope-directive phrases (`the instructions
  field`, `the data field`, `the envelope`). The bare words "data" and
  "accept" are deliberately absent — only the full phrase "the data field"
  and the flag `--accept` are markers, so natural personality prose never
  trips the check. `findPromptMarkers(prompt)` (`:45`) is case-insensitive
  and returns matches in marker-list order without duplicates; a clean
  prompt yields `[]`.
- **Agent model-field cross-checks (DEC-003)**: `agent-model-fields.ts` —
  `checkAgentModelFields(descriptor, label, catalogModels)` (`:29`) is the
  pure, deterministic helper behind the agent model cross-check: an
  empty/non-string `model_override` yields `AGENT_MODEL_OVERRIDE_EMPTY`,
  a `model` outside the supplied catalog enum yields
  `AGENT_MODEL_OUTSIDE_CATALOG`. Free-form non-empty overrides never fail
  here: `model_override` is deliberately not enum-checked.
- **Review findings + semantic-walk validation (CMP-003, CMP-004)**:
  `review-findings.ts` — `parseFindingsFile(filePath)` (`:79`) shape-validates
  the `--findings` YAML (`semantic` + `findings` sections, optional
  `fix?`; any supplied `severity` is dropped so no per-finding severity is
  ever recorded, FR-008/AC-014/AC-015); a missing required field throws
  `FindingsFileError` with `FINDINGS_ENTRY_INVALID` naming the offending
  entry (AC-012). `collectKnownIds(changeRoot)` (`:161`) builds the
  known-id universe (DM-004) by recursively walking every YAML document
  under the change root and collecting every string value matching
  `ID_PATTERN = /^[A-Z]{2,6}-[0-9]{2,4}$/` (`:36`); unreadable/invalid YAML
  files are skipped so a single broken document cannot break target
  resolution. `resolveFindingTargets(findings, knownIds)` (`:204`) classifies
  each target: an id-shaped token inside the target must resolve in the
  universe, else an `UNKNOWN_FINDING_TARGET` warning names the target while
  the round is still recorded (AC-013); targets with no id-shaped token
  are free-text and never warn. `validateSemanticWalk(semantic,
  stageChecks, required)` (`:238`) validates the reviewer-supplied
  `semantic` section against the target stage's `semantic-checks.yaml`
  (review stages carry none of their own): every check must appear exactly
  once as `{check_id, status, evidence}` with non-empty evidence (DM-003,
  FR-010, AC-016); when `required` (i.e. `--accept` with passing mechanical
  checks) the section is mandatory and every status must be `'pass'` —
  missing, incomplete, or failing walks throw `SEMANTIC_WALK_INVALID` with
  nothing written (FR-011, AC-017). Documented blind spot (advisory):
  `ID_PATTERN` excludes single-letter prefixes (e.g. `F-001`), so targets
  referencing them are treated as free text and never warn — widening the
  pattern is a design-review event.
- **Deployment platform renderers (`deploy/platforms/`)**: the deploy layer
  is the ONLY place in the codebase where coding-agent-specific knowledge is
  allowed (agent-agnostic invariant, §2.7). `deploy/platforms/index.ts` —
  `AgentRenderer` / `RenderedAgent` types, a `REGISTRY` keyed by platform
  name and version, `getRenderer(platform, version?)` (`:62`, `undefined` /
  `'latest'` picks the highest known version, unknown platform/version
  throws listing supported versions), `listPlatforms()` (`:42`,
  platform-sorted with ascending versions). `deploy/platforms/opencode.ts` —
  `OPENCODE_RENDERERS` (`:106`, versions 1 and 2) convert a neutral
  `AgentRecord` into an OpenCode `agents/<agent-id>.md` file. The neutral
  permission keys map to target tool keys via `NEUTRAL_TO_TARGET` (`:34`;
  `question` is a render-only key with no stage-contract role);
  `translatePermissions` (`:50`) emits the v2 `permission` map
  (target → neutral level verbatim) and the v1 legacy `tools` map
  (`allow` → `true`, `deny` → `false`, `ask` omitted). The rendered
  frontmatter uses `renderFrontmatter` (`:72`, `yaml` `indent: 2`,
  `lineWidth: 100`), then a blank line, then the system prompt verbatim;
  the rendered `model` is `effectiveModel = modelOverride ?? model`
  (DEC-004), and the source YAML `model` is never mutated by deployment.

## Data & Control Flow
Validation pipeline as executed by `validateArtifact` (and thus by authoring
`--finalize`, review stages, and `bin/lint-artifact.ts` — identical findings):
1. Resolve the stage via `getStageById` (registry scan + meta-schema validation).
2. YAML parse layer is the caller's responsibility (artifact already parsed via
   `readYaml`); a null/non-object artifact yields no findings.
3. JSON Schema layer: `schemaFindings` (`validate.ts:23`) runs the stage
   `schema.yaml` through cached Ajv; failures become blocking `schema` findings.
4. Declaration layer: `validateCheckDeclarations` validates the stage's check
   declarations against the stage schema (path-bearing slots, grammar, and
   schema-typed selectors) and aborts on violation before any check runs.
5. Structural layer: `runStageChecks` runs the named checks declared in the
   stage's `structural-checks.yaml` (see [checks/](checks/codemap.md)).
6. Semantic advisory: the kind interpreter separately evaluates the stage's
   `semantic-checks.yaml` and folds the `SemanticSummary` into the envelope
   (see [kinds/](kinds/codemap.md)).
7. Review gate: `evaluateGate` (above) decides runnability before any of the
   above runs for a stage command; failure produces a blocked envelope naming
   each unsatisfied requirement and its current status.

Stage-run path: `sdlc.ts` → `resolveWorkflow` → `runStage(stage, argv, cwd)`
(kinds dispatcher) → `parseArgs` → `requireChangeRoot` (when `--change` is
required) → `getStageById`/`loadStepDefinitions`/`loadStageHooks` →
`makeCtx(cwd, changeRoot)` → artifact read via `ctx.loadFile` →
`validateArtifact` + semantic evaluation → `detectStep`/kind transition →
`writeJson` envelope.

## Integration
- **Consumed by**: `src/scripts/sdlc.ts` (envelope, registry, agent
  registry, delegation directive), [kinds/](kinds/codemap.md) (step machine,
  gate, validation, context, review findings), [workflows/](workflows/codemap.md)
  (registry, pipeline order, docs index, agent discovery), `bin/lint-artifact.ts`,
  `bin/validate-policies.ts` (declaration path validation, agent meta-schema,
  model-field cross-checks, prompt markers, stage-reference resolution,
  permission compatibility), `bin/deploy-to-agent.ts` (platform renderers
  under `deploy/platforms/`).
- **Depends on**: [../stages/](../stages/codemap.md) and [../agents/](../agents/codemap.md)
  folders discovered at runtime (descriptors + config files),
  `src/schemas/stage.schema.yaml` and `src/schemas/agent.schema.yaml`
  (meta-schemas), `src/policies/errors.yaml` (error catalog), sub-libraries
  [checks/](checks/codemap.md) and [kinds/](kinds/codemap.md); npm deps
  `ajv`, `ajv-formats`, `yaml`.