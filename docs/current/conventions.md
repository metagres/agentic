# conventions.md

## Patterns

| Pattern | Where Used | Evidence |
|---------|------------|----------|
| Declarative stage folder: one folder per stage carrying all config (stage.yaml + kind-specific files); discovered by directory scan, no central enumeration | every stage | src/stages/, src/scripts/lib/stage-registry.ts, AGENTS.md §5 |
| Frozen JSON envelope: every CLI output is {workflow, step, state, instructions, data, errors, warnings}, written via writeJson | all of src/scripts/ | src/scripts/lib/cli.ts, src/schemas/cli-envelope.schema.yaml |
| Central error catalog: errors/warnings are produced by makeError(code) from errors.yaml; no ad-hoc error text | engine, bins, kinds | src/scripts/lib/error-catalog.ts, src/policies/errors.yaml |
| Declarative validation: stages declare named checks from the capped catalog in structural-checks.yaml; no stage-specific validation scripts | authoring + tasks stages | src/stages/*/structural-checks.yaml, src/scripts/lib/checks/index.ts |
| Nested acceptance criteria: requirements artifacts author acceptance criteria inside their owning requirement — each FR and NFR entry carries a required acceptance_criteria array (id, Given-When-Then statement, category happy/edge/negative/boundary); no top-level criteria list and no cross-reference fields (ac_ids, parent_id) between criteria and requirements | requirements stage artifacts | src/stages/requirements/schema.yaml, src/stages/requirements/template.yaml |
| Path-addressed check declarations: structural-check array selector parameters accept a plain top-level name or a multi-segment segment([].segment)* path resolved by the shared artifact-path resolver; cross-path uniqueness scopes are declared through the unique-ids unions parameter; per-check path support is declared through pathParams catalog metadata | authoring + tasks stages (structural-checks.yaml) | src/scripts/lib/artifact-paths.ts, src/scripts/lib/checks/index.ts |
| Neutral agent definitions: one YAML file per agent under src/agents/<id>.yaml (id = filename stem), validated by the engine-owned agent meta-schema; discovered by scan, no central enumeration; invocation mode defaults to all — agents opt down to subagent or primary explicitly | src/agents/ | src/schemas/agent.schema.yaml, src/scripts/lib/agent-registry.ts |
| Prompt purity: agent system prompts carry role/personality only — never CLI flags, script paths, or envelope directive phrases; enforced by a mechanical marker check | src/agents/ | src/scripts/lib/agent-prompt-marker.ts, bin/validate-policies.ts |
| Kind permission contracts: engine-owned per-kind permission profiles beside the interpreters; stage.yaml may override individual keys; changed only with the interpreters | src/scripts/lib/agent-permissions.ts | src/scripts/lib/agent-permissions.ts, src/schemas/stage.schema.yaml |
| Review separation of duties: review rounds are performed by the bound reviewer agent (stage-reviewer), never by the authoring agent; enforced at convention level only — the CLI has no caller-identity signal, so any mechanical guard would be theater and detection is human audit of review rounds | all four review stages | src/scripts/lib/delegation.ts (review-kind directive), bin/deploy-to-agent.ts (SKILL.md rule) |

## Naming

| Construct | Convention | Evidence |
|-----------|------------|----------|
| Artifact IDs | PREFIX-NNN, 3 digits: FR, NFR, AC, DL, SC (requirements); CMP, DM, API, DEC (design); TASK (planning) | src/stages/*/stage.yaml (next_ids), src/scripts/lib/ids.ts |
| Stage id / folder | kebab-case; folder name must equal stage.yaml id | src/stages/, STAGE_ID_MISMATCH in src/policies/errors.yaml |
| Source files | kebab-case .ts | src/scripts/lib/ |
| Error codes | SCREAMING_SNAKE_CASE entries in errors.yaml | src/policies/errors.yaml |
| Skill folder | src/skills/<name>/ where frontmatter name equals <name> | src/skills/, bin/validate-templates.ts |
| Agent id / file | kebab-case; filename stem must equal id | src/agents/, AGENT_SCHEMA_INVALID in src/policies/errors.yaml |

## Error Handling

| Layer | Pattern | Evidence |
|-------|---------|----------|
| CLI output | findings carry code + message + fix from the catalog; state blocked on failure | src/scripts/lib/error-catalog.ts, src/schemas/cli-envelope.schema.yaml |
| Exit codes | EXIT.ok / EXIT.usage / EXIT.actionFailed / EXIT.internal | src/scripts/lib/cli.ts |
| Startup | missing/invalid stage descriptor, unknown kind, folder/id mismatch, requires cycle or missing reference = hard startup error naming the folder | src/scripts/lib/stage-registry.ts, src/policies/errors.yaml |
| Gate | unsatisfied requires produce a blocked envelope naming each requirement and its current status | src/scripts/lib/requires-graph.ts |
| HTTP | none — CLI toolkit, no HTTP layer | package.json |

## File Organization

| Rule | Evidence |
|------|----------|
| Stage = one folder under src/stages/<id>/ with a fixed per-kind file set (authoring: 6 files; review: 2; tasks: 5; aggregator: 3); optional hooks.ts is the only stage-specific code | src/stages/, AGENTS.md §5 |
| Skill sources live under src/skills/<name>/SKILL.md; frontmatter requires name equal to the folder name and a non-empty description; validated by validate:templates | src/skills/, bin/validate-templates.ts |
| Agent = one YAML file under src/agents/<id>.yaml with id equal to the filename stem; neutral permission vocabulary (file_read, search, file_write, shell, subagent, web, question × allow/ask/deny); validated by validate:policies | src/agents/, src/schemas/agent.schema.yaml |
| Dev-only skill convention: dev-only skills (e.g. agent-audit) live under src/skills/<name>/SKILL.md, are invoked manually by the maintainer, never ship in the deployed bundle, and are the only place LLM judgment drives configuration | src/skills/agent-audit/SKILL.md, bin/deploy-to-agent.ts |
| Dev-only skill helper convention: dev-only skills may bundle deterministic helper scripts under src/skills/<name>/scripts/ as plain ESM TypeScript executed directly via node with node builtins only — no build step, no new npm dependencies; typechecked by the existing fast-gate include set (tsconfig includes src/**/*.ts); first instance is improvement-review (four helpers) | src/skills/improvement-review/scripts/, tsconfig.json |
| Model override convention: the agent model field stays the team recommendation and remains enum-checked; optional model_override is a non-empty free-form string, not enum-checked, wins as effectiveModel (model_override ?? model) at deploy; the audit never overwrites an existing override | src/schemas/agent.schema.yaml, src/scripts/lib/agent-registry.ts, src/scripts/lib/deploy/platforms/opencode.ts |
| docs/current index contract: exactly four columns (File, Purpose, When to Read, Notes) and nine fixed document rows; no overview.md; created only by the knowledge-init skill, maintained only by knowledge extraction | src/skills/knowledge-init/SKILL.md |
| Deployed skills are self-contained build artifacts in .opencode/skills/ (agentic-sdlc, knowledge-init): no package.json, node_modules, or source .ts; never edited directly | AGENTS.md §2.9/§10, bin/deploy-to-agent.ts |
| Single central policy: src/policies/errors.yaml is the only central policy file | AGENTS.md §6, src/policies/ |
| Living docs (docs/current/) updated only through knowledge extraction; authoring stages emit delta entries and never edit docs/current directly | AGENTS.md §2.4/§2.5, src/scripts/lib/kinds/aggregator.ts |
| docs/ideas queue contract: docs/ideas holds only open proposal documents whose Status header field carries the disposition (Proposed / Landed in <change-slug> <YYYY-MM-DD> / Dropped <YYYY-MM-DD> — <reason> / Superseded by <slug> <YYYY-MM-DD>); mutable canon lives only in docs/current and changes only via changes; an idea implemented by a change is landed during that change's implementation stage by a documentation task that sets Status to the landing signature "Landed in <change-slug> <YYYY-MM-DD>" (regex ^Landed in \S+ \d{4}-\d{2}-\d{2}$) and moves the file unmodified into the change folder, with implementation-review verifying docs/ideas holds no landed signatures; hosted idea files are frozen with the completed change and referenced read-only | docs/changes/rehome-improvement-review-canon/design.yaml (CMP-005, DM-004), src/skills/improvement-review/SKILL.md |