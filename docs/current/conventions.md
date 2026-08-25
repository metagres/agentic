# conventions.md

## Patterns

| Pattern | Where Used | Evidence |
|---------|------------|----------|
| Declarative stage folder: one folder per stage carrying all config (stage.yaml + kind-specific files); discovered by directory scan, no central enumeration | every stage | src/stages/, src/scripts/lib/stage-registry.ts, AGENTS.md §5 |
| Frozen JSON envelope: every CLI output is {workflow, step, state, instructions, data, errors, warnings}, written via writeJson | all of src/scripts/ | src/scripts/lib/cli.ts, src/schemas/cli-envelope.schema.yaml |
| Central error catalog: errors/warnings are produced by makeError(code) from errors.yaml; no ad-hoc error text | engine, bins, kinds | src/scripts/lib/error-catalog.ts, src/policies/errors.yaml |
| Declarative validation: stages declare named checks from the capped catalog in structural-checks.yaml; no stage-specific validation scripts | authoring + tasks stages | src/stages/*/structural-checks.yaml, src/scripts/lib/checks/index.ts |

## Naming

| Construct | Convention | Evidence |
|-----------|------------|----------|
| Artifact IDs | PREFIX-NNN, 3 digits: FR, NFR, AC, DL, SC (requirements); CMP, DM, API, DEC (design); TASK (planning) | src/stages/*/stage.yaml (next_ids), src/scripts/lib/ids.ts |
| Stage id / folder | kebab-case; folder name must equal stage.yaml id | src/stages/, STAGE_ID_MISMATCH in src/policies/errors.yaml |
| Source files | kebab-case .ts | src/scripts/lib/ |
| Error codes | SCREAMING_SNAKE_CASE entries in errors.yaml | src/policies/errors.yaml |
| Skill folder | src/skills/<name>/ where frontmatter name equals <name> | src/skills/, bin/validate-templates.ts |

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
| docs/current index contract: exactly four columns (File, Purpose, When to Read, Notes) and nine fixed document rows; no overview.md; created only by the knowledge-init skill, maintained only by knowledge extraction | src/skills/knowledge-init/SKILL.md |
| Deployed skills are self-contained build artifacts in .opencode/skills/ (agentic-sdlc, knowledge-init): no package.json, node_modules, or source .ts; never edited directly | AGENTS.md §2.9/§10, bin/deploy-to-agent.ts |
| Single central policy: src/policies/errors.yaml is the only central policy file | AGENTS.md §6, src/policies/ |
| Living docs (docs/current/) updated only through knowledge extraction; authoring stages emit delta entries and never edit docs/current directly | AGENTS.md §2.4/§2.5, src/scripts/lib/kinds/aggregator.ts |