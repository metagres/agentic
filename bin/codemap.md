# bin/

## Responsibility
Standalone CLI entry points for developer/CI tooling, each invoked directly by an npm
script. These are not the agent-facing CLI — that is `src/scripts/sdlc.ts` (bundled to
`dist/sdlc.js` for deployment). The bins here validate the repository's own contracts
(schemas, policies, stage folders, agents, skills) and build/deploy the two
self-contained skill bundles plus per-platform rendered agent files.

## Design Patterns
- **Thin bin wrappers**: each bin is a top-level script that composes shared engine
  modules from `src/scripts/lib/` (no duplicated logic). E.g. `lint-artifact.ts` reuses
  `parseArgs` (`src/scripts/lib/cli.ts`), `readYaml` (`src/scripts/lib/yaml-io.ts`),
  `validateArtifact` (`src/scripts/lib/validate.ts`), `makeCtx` (`src/scripts/lib/context.ts`),
  and `makeError` (`src/scripts/lib/error-catalog.ts`) so external linting produces
  findings identical to internal finalization.
- **JSON-only reporting**: every bin emits a single structured JSON document on stdout
  (`{ok, ...}`) and exits 0/1 (or 2 on usage errors in `lint-artifact.ts`), making the
  output machine-consumable by the npm pipeline.
- **Lock-serialized builds**: `runBuild()` in `deploy-to-agent.ts:70` uses a
  `.deploy-build.lock` file with a 180 s deadline to serialize `tsup` builds across
  concurrent deploy invocations (tsup runs with `clean: true`).
- **Self-contained bundle assembly**: `compileStageHooks()` (`deploy-to-agent.ts:114`)
  esbuild-bundles each stage's `hooks.ts` into `hooks.js` and deletes the `.ts` source,
  so the deployed skill contains no TypeScript.
- **Platform renderer indirection**: `deploy-to-agent.ts` resolves a renderer via
  `getRenderer(platform, version)` (`src/scripts/lib/deploy/platforms/`), so both skills
  deploy identically for every platform while only the rendered agent files vary by
  platform/version.

## Data & Control Flow
1. `validate-schemas.ts` — scans `src/schemas/*.yaml`, compiles each with Ajv
   (`allErrors: true, strict: false` + `ajv-formats`), reports per-file results, exits
   nonzero on any compile failure.
2. `validate-policies.ts` — (a) checks `src/policies/errors.yaml` defines `errors` with a
   `message` per code; (b) for each folder under `src/stages/`, validates `stage.yaml`
   against the `src/schemas/stage.schema.yaml` meta-schema (compiled via `ajv.compile`),
   resolves `structural-checks.yaml` check names + required params against `CHECK_CATALOG`
   (`src/scripts/lib/checks/index.ts`), runs declaration path validation
   (`validateCheckDeclarations` from `src/scripts/lib/validate.ts` — every `[]`-bearing
   parameter string must sit inside a path-bearing slot and resolve against the governing
   stage schema), checks `steps.yaml` defines a `steps` map, and
   compiles `schema.yaml` as a JSON schema — unless the descriptor declares `schema_from`,
   in which case the local `schema.yaml` must be absent and the named stage's schema
   must exist; (c) loads the registry once via `loadStageRegistry(root)` (shared by
   declaration validation and the graph check) and fails on any
   missing `requires` reference; (d) validates every `src/agents/*.yaml` against
   `src/schemas/agent.schema.yaml` (descriptor id = filename stem), runs the model-field
   cross-check (`checkAgentModelFields` against the schema's model enum), rejects prompt
   purity markers (`findPromptMarkers`), resolves every stage `agent` reference
   (`getAgentById`), and enforces stage/agent permission compatibility
   (`checkAgentCompatibility`) — an empty roster of agents passes silently; (e) asserts
   the five canonical stages are discoverable via `getStageById`.
3. `validate-templates.ts` — verifies the three authoring stage templates
   (`src/stages/<stage>/template.yaml`) carry the expected top-level keys, the correct
   `metadata.stage`, and (requirements only) `discovery_reviewed`/`scenarios_reviewed`
   initialized to false plus at least one requirement entry carrying a non-empty nested
   `acceptance_criteria` array (the nested-criteria scaffold contract, AC-019); then
   validates every folder under `src/skills/`: `SKILL.md`
   frontmatter `name` equals the folder name and `description` is a non-empty string.
4. `lint-artifact.ts` — parses `--target/--artifact/--cwd/--no-fail`, maps the legacy
   alias `plan` → stage `planning` (`TARGET_TO_STAGE`), reads the artifact with
   `readYaml`, builds a context with `makeCtx(cwd, changeRoot)`, runs
   `validateArtifact(stageId, artifact, cwd, changeRoot)`, prints blocking findings, and
   exits 1 on any finding unless `--no-fail`.
5. `deploy-to-agent.ts` — `main()` (`:247`) resolves `--dest` (or first positional),
   optional `--platform`/`--platform-version` (renderer via `getRenderer`, default
   `opencode`/latest), `--clean` (removes both skill dirs, the legacy `sdlc/` runtime
   dir, `LEGACY_SKILL_IDS`, and stale rendered agent files whose source definitions no
   longer exist), loads the neutral agent roster (`loadAgentRegistry`), runs `runBuild()`
   → `npm run build` (tsup → `dist/sdlc.js`), copies the bundle to
   `<dest>/skills/agentic-sdlc/scripts/sdlc.js`, copies `src/schemas`, `src/policies`,
   `src/stages` into the skill folder, compiles stage hooks, renders `SKILL.md` from
   `SKILL_TEMPLATE` (`:167`) using `skillManifest` + `getStageDescriptions(root)` for the
   workflow list, writes `manifest.json` (`{name, version, deployedAt, cliPath}`),
   deploys the CLI-less `knowledge-init` skill (SKILL.md + minimal manifest, no
   scripts), and renders each agent to its platform path under `<dest>/agents/`.
   Unless `--skip-smoke`, it runs the deployed CLI (`--list-workflows`), asserts the
   delegation-rule marker phrase (`DELEGATION_RULE_MARKER`) in the generated SKILL.md,
   checks each skill's frontmatter, and validates every rendered agent file (frontmatter
   parses, description non-empty, filename stem = agent id, rendered `model` equals the
   agent's `effectiveModel`).

## Integration
- **Consumed by (npm scripts, `package.json`)**:
  - `validate:schemas` → `bin/validate-schemas.ts`
  - `validate:policies` → `bin/validate-policies.ts`
  - `validate:templates` → `bin/validate-templates.ts`
  - `validate` → schemas + policies + templates + `typecheck` (tsc --noEmit) + `test:unit`
  - `test:all` → `validate` + unit/e2e tests; `check:all` → `test:all` + `deploy:smoke`
  - `deploy:smoke` → `bin/deploy-to-agent.ts --dest .tmp/agent --clean`
  - `deploy` → `bin/deploy-to-agent.ts`
- **Depends on**: `src/scripts/lib/` (yaml-io, cli, validate, context, error-catalog,
  stage-registry, agent-registry, agent-model-fields, agent-permissions,
  agent-prompt-marker, paths, checks catalog, version, deploy/platforms renderers) and
  `src/scripts/workflows/skill-manifest.ts` (the `skillManifest` single source for the
  deployed skill identity).
- **Produces**: the deployed build artifact — `<dest>/skills/agentic-sdlc/` (`SKILL.md`,
  `scripts/sdlc.js`, `stages/`, `schemas/`, `policies/`, `manifest.json`),
  `<dest>/skills/knowledge-init/` (`SKILL.md` + `manifest.json`, no CLI/scripts), and
  `<dest>/agents/` (one rendered `<agent-id>.md` per source definition) — never to be
  edited as source.
