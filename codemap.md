# Repository Atlas: agentic

## Project Responsibility
Development repository for the **agentic SDLC toolkit** (package
`agentic-sdlc-toolkit`) — a CLI (`sdlc`) that drives a full software
development lifecycle for OpenCode-compatible AI coding agents: requirements →
design → planning → implementation, each gated by an append-only review stage,
terminating in knowledge extraction that syncs living docs
(`docs/current/`). The architecture is configuration-driven: stages are
discovered as folders (no central enumeration), validated by a capped catalog
of generic structural checks, ordered by a `requires` DAG with an acceptance
gate, and surfaced through a frozen JSON envelope
`{workflow, step, state, instructions, data, errors, warnings}`. The built
output is two self-contained skills deployed to the agent runtime
(`.opencode/skills/agentic-sdlc/` and `.opencode/skills/knowledge-init/` —
build artifacts, never source), alongside rendered agent files under
`.opencode/agents/`.

## System Entry Points
- `src/scripts/sdlc.ts` — the agent-facing CLI (npm bin `sdlc`); dispatches to
  stage kind interpreters and cross-cutting workflows; emits the frozen
  envelope. Bundled by tsup to `dist/sdlc.js` and deployed as
  `scripts/sdlc.js` inside the skill.
- `package.json` — dependency manifest (ajv, ajv-formats, ignore, yaml) and
  the validation pipeline: `validate` (fast gate: schemas + policies +
  templates + typecheck + unit tests), `test:e2e` (end-to-end suite),
  `check:all` (full coverage: validate + unit + e2e + deploy smoke),
  `deploy:smoke` (deploy to `.tmp/agent` + CLI smoke test).
- `bin/` — developer/CLI tooling: `deploy-to-agent.ts` (bundle + skill
  assembly + smoke test), `lint-artifact.ts` (external artifact lint via the
  same `validateArtifact` path), `validate-schemas.ts`, `validate-policies.ts`,
  `validate-templates.ts`.
- `tsup.config.ts` — single-entry ESM bundle of `src/scripts/sdlc.ts`
  (node20, everything inlined via `noExternal`).
- `generate_context.js` — compiles repo source into `llm_context.txt`
  (gitignored) using `.contextignore` (falls back to `.gitignore`).
- `AGENTS.md` — mandatory rules for AI coding agents: the one rule (validate
  before declaring done), invariants, terminology, stage-folder layout, and
  validation layers. `codemap.md` (this file) is the map of the repository.

## Directory Map (Aggregated)
| Directory | Responsibility Summary | Detailed Map |
|---|---|---|
| `bin/` | Standalone CLI entry points for validation and deployment, each wrapped by an npm script; assembles the self-contained skill bundle. | [View Map](bin/codemap.md) |
| `src/` | Source tree: engine code, stage configuration, the skill source store (`src/skills/`), and the YAML asset layer (schemas/policies) the engine loads and enforces. | [View Map](src/codemap.md) |
| `src/scripts/` | The sdlc CLI runtime: command dispatch, workflow resolution, frozen envelope emission. | [View Map](src/scripts/codemap.md) |
| `src/scripts/lib/` | Engine core: stage/agent discovery, requires-DAG + acceptance gate, unified validation orchestrator (with declaration path validation), the artifact path resolver (`artifact-paths.ts`), declarative step machine, kind permission contracts, delegation + review-findings helpers, deploy platform renderers (`deploy/platforms/`), shared plumbing. | [View Map](src/scripts/lib/codemap.md) |
| `src/scripts/lib/delegation.ts` | Pure delegation-directive composer consumed by the envelope funnel (`normalizeEnvelope`): composes binding-derived directives from `StageRecord.agent` (self clause, unavailability fallback, reviewer-directed phrasing for review kinds) with no hardcoded agent ids (NFR-002 / AC-010). | documented here |
| `src/scripts/lib/checks/` | The capped catalog of ten named generic structural checks — the single extension path for structural validation logic; array selections address nested collections through `segment([].segment)*` path selectors resolved against the stage schema. | [View Map](src/scripts/lib/checks/codemap.md) |
| `src/scripts/lib/kinds/` | The four kind interpreters (authoring flag loop, review append-only rounds, tasks state machine over plan.yaml, aggregator delta collection). | [View Map](src/scripts/lib/kinds/codemap.md) |
| `src/scripts/workflows/` | Cross-cutting commands (status, feedback, doctor) and the single `skillManifest` for the deployed skill. | [View Map](src/scripts/workflows/codemap.md) |
| `src/skills/` | Version-controlled skill sources: the knowledge-init SKILL.md deployed as a second self-contained skill beside agentic-sdlc, plus two development-only skills that are **never** bundled or deployed — `agent-audit/` (live catalog refresh, web-grounded model assignment, permission auto-fix, roster dedupe/add/remove) and `improvement-review/` (six-step SDLC improvement review: SKILL.md method driver plus four bundled deterministic TypeScript helper scripts under `scripts/` — measure_artifacts, envelope_sizes, mine_transcript, validate_duration — the first dev-only skill to bundle scripts; a pure advisor — it reads the goals canon (`docs/current/capabilities.md`, `## SDLC Goals`) and the baselines (`docs/current/operations.md`, `## Baselines`) read-only and writes only `docs/ideas/` proposals). | documented here |
| `src/agents/` | Neutral agent definitions — one `<agent-id>.yaml` per agent (six shipped), discovered by directory scan and validated by the engine-owned `src/schemas/agent.schema.yaml`; referenced optionally from `stage.yaml` descriptors. Each descriptor carries a recommended `model` (enum-checked) and an optional free-form `model_override`; the registry computes `effectiveModel = model_override ?? model`, deployment renders the effective model into frontmatter while the source keeps the recommendation, and CLI data surfaces both values. | documented here |
| `src/stages/` | The structural source of truth: one folder per stage (9 stages) carrying the full declarative configuration, discovered by directory scan. | [View Map](src/stages/codemap.md) |

Not mapped (excluded by design): `test/` (unit + e2e suites), `docs/`
(project documentation), `dist/` + `.opencode/` (build artifacts), `temp/`.

## Pipeline Topology (from the requires DAG)
```
requirements → requirements-review → design → design-review →
planning (requires requirements-review + design-review) → planning-review →
implementation → implementation-review → knowledge-extraction
```
A stage is runnable only when every required stage's tracked artifact is
`accepted`; review stages are runnable when their tracked artifact is
`ready-for-review` or `accepted`. Order is the topological sort of this graph
with an alphabetical tie-break — there is no sequence field.