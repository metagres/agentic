# bin/

## Responsibility
Standalone CLI entry points for developer/CI tooling, each invoked directly by an npm
script. These are not the agent-facing CLI — that is `src/scripts/sdlc.ts` (bundled to
`dist/sdlc.js` for deployment). The bins here validate the repository's own contracts
(schemas, policies, stage folders, templates) and build/deploy the self-contained skill
bundle.

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
- **Lock-serialized builds**: `runBuild()` in `deploy-to-agent.ts:62` uses a
  `.deploy-build.lock` file with a 180 s deadline to serialize `tsup` builds across
  concurrent deploy invocations (tsup runs with `clean: true`).
- **Self-contained bundle assembly**: `compileStageHooks()` (`deploy-to-agent.ts:106`)
  esbuild-bundles each stage's `hooks.ts` into `hooks.js` and deletes the `.ts` source,
  so the deployed skill contains no TypeScript.

## Data & Control Flow
1. `validate-schemas.ts` — scans `src/schemas/*.yaml`, compiles each with Ajv
   (`allErrors: true, strict: false` + `ajv-formats`), reports per-file results, exits
   nonzero on any compile failure.
2. `validate-policies.ts` — (a) checks `src/policies/errors.yaml` defines `errors` with a
   `message` per code; (b) for each folder under `src/stages/`, validates `stage.yaml`
   against the `src/schemas/stage.schema.yaml` meta-schema (compiled via `ajv.compile`),
   resolves `structural-checks.yaml` check names + required params against `CHECK_CATALOG`
   (`src/scripts/lib/checks/index.ts`), checks `steps.yaml` defines a `steps` map, and
   compiles `schema.yaml` as a JSON schema; (c) loads the registry via
   `loadStageRegistry(root)` and fails on any missing `requires` reference; (d) asserts
   the five canonical stages are discoverable via `getStageById`.
3. `validate-templates.ts` — verifies `template.yaml` top-level key sets and
   `metadata.stage` for the three authoring stages (requirements, design, planning) and
   that `src/templates/docs-current-index.md` contains the expected table header.
4. `lint-artifact.ts` — parses `--target/--artifact/--cwd/--no-fail`, maps the legacy
   alias `plan` → stage `planning` (`TARGET_TO_STAGE`), reads the artifact with
   `readYaml`, builds a context with `makeCtx(cwd, changeRoot)`, runs
   `validateArtifact(stageId, artifact, cwd, changeRoot)`, prints blocking findings, and
   exits 1 on any finding unless `--no-fail`.
5. `deploy-to-agent.ts` — `main()` (`:195`) resolves `--dest` (or first positional),
   optionally `--clean` (removes the skill dir, legacy `sdlc/` runtime dir, and
   `LEGACY_SKILL_IDS`), runs `runBuild()` → `npm run build` (tsup → `dist/sdlc.js`),
   copies the bundle to `<dest>/skills/agentic-sdlc/scripts/sdlc.js`, copies
   `src/templates`, `src/schemas`, `src/policies`, `src/stages` into the skill folder,
   compiles stage hooks, renders `SKILL.md` from `SKILL_TEMPLATE` (`:154`) using
   `skillManifest` + `getStageDescriptions(root)` for the workflow list, writes
   `manifest.json` (`{name, version, deployedAt, cliPath}`), and — unless
   `--skip-smoke` — runs `node scripts/sdlc.js --list-workflows` inside the deployed
   skill as a smoke test.

## Integration
- **Consumed by (npm scripts, `package.json`)**:
  - `validate:schemas` → `bin/validate-schemas.ts`
  - `validate:policies` → `bin/validate-policies.ts`
  - `validate:templates` → `bin/validate-templates.ts`
  - `validate` → schemas + policies + templates + `typecheck` (tsc --noEmit) + `test`
  - `test:all` / `check:all` → `validate` + unit/e2e tests, then `deploy:smoke`
  - `deploy:smoke` → `bin/deploy-to-agent.ts --dest .tmp/agent --clean`
  - `deploy` → `bin/deploy-to-agent.ts`
- **Depends on**: `src/scripts/lib/` (yaml-io, cli, validate, context, error-catalog,
  stage-registry, checks catalog, version) and `src/scripts/workflows/skill-manifest.ts`
  (the `skillManifest` single source for the deployed skill identity).
- **Produces**: the deployed build artifact at `<dest>/skills/agentic-sdlc/` (one
  self-contained skill: `SKILL.md`, `scripts/sdlc.js`, `stages/`, `templates/`,
  `schemas/`, `policies/`, `manifest.json`) — never to be edited as source.