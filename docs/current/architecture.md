# architecture.md

## Tech Stack

| Layer | Technology | Version | Evidence |
|-------|------------|---------|----------|
| Runtime | Node.js | >=20 | package.json (engines) |
| Language | TypeScript (ESM, strict) | compiler ^7.0.2 | tsconfig.json |
| Bundling | tsup (single ESM entry, noExternal) | ^8.5.1 | tsup.config.ts |
| Schema validation | ajv + ajv-formats | ^8.20.0 / ^3.0.1 | src/scripts/lib/schema.ts |
| Config/artifact format | YAML | ^2.5.1 | src/scripts/lib/yaml-io.ts |
| Test runner | node --test (built-in) | node >=20 | package.json (scripts) |

## Component Boundaries

```mermaid
graph TD
  AGENT[AI agent runtime] -->|argv + frozen JSON envelope| CLI[sdlc CLI: src/scripts/sdlc.ts]
  CLI --> REG[workflow registry: src/scripts/workflows/index.ts]
  REG -->|stage commands| KINDS[kind interpreters: src/scripts/lib/kinds/]
  REG -->|cross-cutting| XW[status / feedback / doctor: src/scripts/workflows/]
  KINDS --> ENGINE[engine core: stage-registry, requires-graph, validate]
  ENGINE --> STAGES[stage folders: src/stages/<id>/]
  ENGINE --> CHECKS[capped check catalog: src/scripts/lib/checks/]
  ENGINE --> POLICIES[src/policies/errors.yaml]
  BIN[developer bins: bin/] --> ENGINE
  BIN --> DEPLOY[bin/deploy-to-agent.ts]
  SKILLSRC[skill sources: src/skills/] --> DEPLOY
  DEPLOY -->|two self-contained skills| RUNTIME[.opencode/skills/ build artifact]
```

## Folder Responsibilities

| Folder | Claimed (CodeMap) | Actual Exports/Entry | Mismatch? | Evidence |
|--------|-------------------|----------------------|-----------|----------|
| src/scripts/ | CLI runtime: dispatch, workflow resolution, envelope | src/scripts/sdlc.ts (npm bin `sdlc`) | No | package.json, src/scripts/sdlc.ts |
| src/scripts/lib/ | Engine core: discovery, requires-DAG + acceptance gate, validation orchestrator, artifact-path resolver, step machine, delegation-directive composer, agent registry + kind permission contracts + prompt markers | stage-registry.ts, requires-graph.ts, validate.ts, artifact-paths.ts, agent-registry.ts, agent-permissions.ts, agent-prompt-marker.ts, delegation.ts | No | src/scripts/lib/ |
| src/scripts/lib/checks/ | Capped catalog of ten named generic structural checks; array selections address nested collections through segment([].segment)* path selectors resolved by the shared artifact-path resolver | index.ts catalog | No | src/scripts/lib/checks/index.ts, src/scripts/lib/artifact-paths.ts |
| src/scripts/lib/kinds/ | Four kind interpreters (authoring, review, tasks, aggregator) | authoring.ts, review.ts, tasks.ts, aggregator.ts | No | src/scripts/lib/kinds/ |
| src/scripts/lib/deploy/platforms/ | Deployment-layer platform renderer registry: platform + version → renderer (directory, naming, frontmatter, permission translation) | index.ts (getRenderer), opencode.ts (v1/v2) | No | src/scripts/lib/deploy/platforms/ |
| src/scripts/workflows/ | Cross-cutting commands + single skillManifest | index.ts (resolveWorkflow, listWorkflows) | No | src/scripts/workflows/index.ts |
| src/stages/ | Structural source of truth: 9 stage folders, declarative config | stage.yaml per folder (5 authoring/tasks, 4 review) | No | src/stages/ |
| src/agents/ | Agent definitions: one YAML file per agent, discovered by scan, validated by the engine-owned agent meta-schema | <agent-id>.yaml per agent (6 shipped) | No | src/agents/, src/schemas/agent.schema.yaml |
| src/skills/ | Version-controlled skill sources: knowledge-init (deployed) + agent-audit and improvement-review (dev-only, excluded from the deployed bundle); improvement-review is the first dev-only skill to bundle scripts (four deterministic helpers under scripts/) | src/skills/knowledge-init/SKILL.md, src/skills/agent-audit/SKILL.md, src/skills/improvement-review/SKILL.md + scripts/ | No | codemap.md, src/skills/ |
| src/policies/ | YAML asset layer: single central policy | src/policies/errors.yaml | No | src/policies/ |
| src/schemas/ | YAML asset layer: meta-schemas; the agent.schema.yaml model enum is live-endpoint-fed (sorted opencode/<id> qualifications from GET http://opencode.ai/zen/go/v1/models, migrated from opencode-go/*) rather than hand-maintained | stage.schema.yaml, agent.schema.yaml, cli-envelope.schema.yaml, docs-delta.schema.yaml | No | src/schemas/ |
| bin/ | Developer CLI tooling: validation, lint, deployment | deploy-to-agent.ts, lint-artifact.ts, validate-{schemas,policies,templates}.ts | No | bin/ |
| test/ | Unit + e2e suites | node --test test/unit, test/e2e | No | package.json (scripts) |
| docs/current/ | Living docs, created only by knowledge-init, maintained by knowledge extraction | index.md + 9 documents | No | src/skills/knowledge-init/SKILL.md |

## Integration Points

| Boundary | Caller | Callee | Protocol | Evidence |
|----------|--------|--------|----------|----------|
| Agent ↔ CLI | AI agent | sdlc CLI | argv in; frozen 7-field JSON envelope out | src/schemas/cli-envelope.schema.yaml, src/scripts/sdlc.ts |
| Deploy → runtime | bin/deploy-to-agent.ts | .opencode/skills/ | file copy + manifest.json per skill | bin/deploy-to-agent.ts |
| Deploy → agents | bin/deploy-to-agent.ts | <dest>/agents/<agent-id>.md | renderer per platform/version; skills stay platform-uniform | bin/deploy-to-agent.ts, src/scripts/lib/deploy/platforms/ |
| Skill source → deploy | bin/deploy-to-agent.ts | src/skills/knowledge-init/SKILL.md | file copy (fail names missing source) | bin/deploy-to-agent.ts |
| CLI → stage config | kind interpreters | src/stages/<id>/*.yaml | YAML load at startup | src/scripts/lib/stage-registry.ts |
| Validation layers | validateArtifact | ajv (schema) → named checks → semantic checklist → review gate | function call, single orchestrator | src/scripts/lib/validate.ts |
| Check declarations → artifact paths | named structural checks + next-id allocation | src/scripts/lib/artifact-paths.ts (shared resolver) | segment([].segment)* path specs resolved against the artifact document; malformed paths abort validation against the stage schema; planning validates tasks[].acceptance_ids through path-addressed ref-exists into the nested per-requirement criteria arrays; next_ids specs accept string or string[] | src/scripts/lib/artifact-paths.ts, src/scripts/lib/checks/, src/scripts/lib/ids.ts |
| Lint → validation | bin/lint-artifact.ts | validateArtifact | same path as internal finalize | bin/lint-artifact.ts |