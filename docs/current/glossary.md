# glossary.md

## Entity: Stage Descriptor (stage.yaml)

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| version | int | No | src/schemas/stage.schema.yaml |
| id | string (kebab-case) | No | src/schemas/stage.schema.yaml |
| kind | authoring \| review \| tasks \| aggregator | No | src/schemas/stage.schema.yaml |
| title | string | No | src/schemas/stage.schema.yaml |
| artifact | string (file name in change dir) | No | src/schemas/stage.schema.yaml |
| status_field | string (metadata field holding status) | No | src/schemas/stage.schema.yaml |
| requires | string[] | No (may be empty) | src/schemas/stage.schema.yaml |
| reviews | string (stage id) | review kind only | src/stages/design-review/stage.yaml |
| review_file | string | review kind only | src/stages/design-review/stage.yaml |
| next_ids | map prefix → array key | authoring kind only | src/stages/requirements/stage.yaml |
| produces_delta | bool | No | src/schemas/stage.schema.yaml |
| delta_phase | string | authoring, delta-producing only | src/stages/design/stage.yaml |

| Relationships | Type | Target | Source |
|---------------|------|--------|--------|
| requires | DAG edge | another stage id | src/scripts/lib/requires-graph.ts |
| reviews | ownership | authoring/tasks stage | src/stages/*/stage.yaml |
| folder name | identity | id field | STAGE_ID_MISMATCH in src/policies/errors.yaml |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Discovery | every stage is one folder under src/stages/<id>/; no central enumeration | src/scripts/lib/stage-registry.ts |
| Gate | stage runnable only when every required stage's tracked artifact is `accepted`; review stages when theirs is `ready-for-review` or `accepted` | src/scripts/lib/requires-graph.ts |
| Startup | cycle or missing requires reference is a hard startup error | STAGE_CYCLE, STAGE_MISSING_REFERENCE in src/policies/errors.yaml |

## Entity: CLI Envelope

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| workflow | string | No | src/schemas/cli-envelope.schema.yaml |
| step | string | No | src/schemas/cli-envelope.schema.yaml |
| state | ok \| in_progress \| blocked \| complete | No | src/schemas/cli-envelope.schema.yaml |
| instructions | string | No | src/schemas/cli-envelope.schema.yaml |
| data | object | No | src/schemas/cli-envelope.schema.yaml |
| errors | array of {code, message, fix?} | No | src/scripts/lib/error-catalog.ts |
| warnings | array of {code, message, fix?} | No | src/scripts/lib/error-catalog.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Frozen shape | no new top-level fields; additionalProperties: false | src/schemas/cli-envelope.schema.yaml, AGENTS.md (invariant 8) |

## Entity: Artifact Status

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| status | draft \| ready-for-review \| accepted \| rejected \| blocked | No | AGENTS.md (terminology), src/scripts/lib/requires-graph.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Ownership | CLI owns lifecycle state transitions | src/scripts/lib/kinds/authoring.ts, src/scripts/lib/kinds/review.ts |
| Review history | append-only; rounds never deleted | src/scripts/lib/kinds/review.ts, AGENTS.md (invariant 3) |

## Entity: Docs Delta (docs-delta.yaml)

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| metadata.stage | string | No | src/scripts/lib/kinds/aggregator.ts |
| metadata.status | complete | No | src/scripts/lib/kinds/aggregator.ts |
| metadata.updated | date | No | src/scripts/lib/kinds/aggregator.ts |
| deltas_applied | int | No | src/scripts/lib/kinds/aggregator.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Creator | written only by `sdlc knowledge-extraction --complete`; the CLI never creates docs/current | src/scripts/lib/kinds/aggregator.ts |
| Source deltas | collected from delta arrays of all delta-producing stages | src/scripts/lib/kinds/aggregator.ts |

## Entity: Plan Task (plan.yaml)

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| id | TASK-NNN | No | src/stages/implementation/schema.yaml |
| title, description | string | No | src/stages/implementation/schema.yaml |
| status | pending \| in_progress \| done \| blocked \| skipped | No | INVALID_TASK_STATUS in src/policies/errors.yaml |
| type | analysis \| setup \| implementation \| refactor \| test \| verification \| release \| documentation | No | src/stages/implementation/schema.yaml |
| covers, acceptance_ids, design_refs, depends_on | string[] | No | src/stages/implementation/schema.yaml |
| files_changed | array of {path, operation} | No | src/stages/implementation/schema.yaml |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Terminal gate | all tasks must be terminal before implementation finalizes | all-tasks-terminal in src/scripts/lib/checks/ |
| Acyclic deps | depends_on must be acyclic and order-consistent | dependency-acyclic, dependency-order in src/scripts/lib/checks/ |

## Entity: Skill Folder (src/skills)

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| SKILL.md | file | No | src/skills/knowledge-init/SKILL.md |
| frontmatter.name | string, equals folder name | No | bin/validate-templates.ts |
| frontmatter.description | non-empty string | No | bin/validate-templates.ts |
| frontmatter.inputs / outputs | string[] | Yes | src/skills/knowledge-init/SKILL.md |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Deployed form | self-contained: no package.json, node_modules, or .ts files; manifest.json carries name, version, deployedAt (cliPath only for skills that ship a CLI) | bin/deploy-to-agent.ts, AGENTS.md (invariant 9) |
| Sole creator | knowledge-init is the only component that creates docs/current | src/skills/knowledge-init/SKILL.md |

## Entity: Agent Definition (src/agents/<agent-id>.yaml)

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| version | int (const 1) | No | src/schemas/agent.schema.yaml |
| id | string (kebab-case, = filename stem) | No | src/schemas/agent.schema.yaml |
| description | string (non-empty) | No | src/schemas/agent.schema.yaml |
| model | enum of 23 fully qualified opencode-go ids | No | src/schemas/agent.schema.yaml |
| temperature | number 0.0–1.0 | No | src/schemas/agent.schema.yaml |
| mode | subagent \| primary \| all | Yes (omitted → all) | src/schemas/agent.schema.yaml |
| permissions | map: file_read, search, file_write, shell, subagent, web, question → allow \| ask \| deny | No | src/schemas/agent.schema.yaml |
| system_prompt | string (non-empty) | No | src/schemas/agent.schema.yaml |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Discovery | one YAML file per agent under src/agents/<id>.yaml; no central enumeration | src/scripts/lib/agent-registry.ts |
| Startup | invalid YAML, schema violation, or id/filename mismatch is a hard startup error naming the file | src/scripts/lib/agent-registry.ts |
| Mode default | omitted mode resolves to all — directly invocable AND delegable | src/scripts/lib/agent-registry.ts |
| Purity | system prompts carry role/personality only; CLI/skill markers fail validation | src/scripts/lib/agent-prompt-marker.ts, bin/validate-policies.ts |

## Entity: Kind Permission Contract

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| kind | authoring \| review \| tasks \| aggregator | No | src/scripts/lib/agent-permissions.ts |
| contract | map of neutral permission keys → allow (floor) / deny (ceiling) | No | src/scripts/lib/agent-permissions.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Ownership | engine-owned beside the kind interpreters; changed only with the interpreters | src/scripts/lib/agent-permissions.ts |
| Overrides | stage.yaml permissions map overrides individual keys of the kind contract | src/schemas/stage.schema.yaml, src/scripts/lib/agent-permissions.ts |
| Compatibility | floors must be allow, ceilings must be deny; multi-bound agents satisfy union of floors and intersection of ceilings | src/scripts/lib/agent-permissions.ts |

## Entity: Platform Renderer

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| platform | string (e.g. opencode) | No | src/scripts/lib/deploy/platforms/index.ts |
| version | int (format revision) | No | src/scripts/lib/deploy/platforms/index.ts |
| renderAgent | AgentRecord → RenderedAgent (path + content) | No | src/scripts/lib/deploy/platforms/index.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Registry | deployment-layer registry keyed by platform + version; getRenderer resolves, latest is the default | src/scripts/lib/deploy/platforms/index.ts |
| OpenCode v2 | permission frontmatter map; target tool keys carry the neutral level verbatim | src/scripts/lib/deploy/platforms/opencode.ts |
| OpenCode v1 | legacy tools frontmatter; allow → true, deny → false, ask omitted | src/scripts/lib/deploy/platforms/opencode.ts |
| Translation | file_read → read/list, search → glob/grep, file_write → edit/write/apply_patch, shell → bash, subagent → task, web → webfetch/websearch, question → question | src/scripts/lib/deploy/platforms/opencode.ts |
| Frontmatter | rendered agents/<id>.md header carries description, mode (invocation mode), model, temperature beside the permission/tools map | src/scripts/lib/deploy/platforms/opencode.ts |

## Naming Cross-Check

| Backend Term | Frontend Term | Same Concept? | Action |
|--------------|---------------|---------------|--------|
| n/a — single-process CLI toolkit, no backend/frontend split | — | — | — |