# operations.md

## Commands

| Command | Purpose | Evidence |
|---------|---------|----------|
| npm run validate | fast gate: schemas + policies (incl. agent definitions: schema, prompt markers, reference resolution, permission compatibility) + templates (incl. skill frontmatter) + typecheck + unit tests only — no e2e builds | package.json (scripts.validate) |
| npm run check:all | full coverage gate: test:all (validate + unit + e2e) + deploy smoke | package.json (scripts.check:all) |
| npm run test:all | validate + unit + e2e | package.json |
| npm test | node --test over unit + e2e | package.json (scripts.test) |
| npm run test:unit | unit tests only | package.json |
| npm run test:e2e | end-to-end tests only | package.json |
| npm run typecheck | tsc --noEmit | package.json |
| npm run build | tsup bundle of src/scripts/sdlc.ts → dist/ | package.json, tsup.config.ts |
| npm run validate:schemas | validate schema assets | package.json |
| npm run validate:policies | validate errors.yaml + stage folders (descriptors, checks, steps, schemas) + agent definitions (schema, prompt markers, reference resolution, permission compatibility) | package.json, bin/validate-policies.ts |
| npm run validate:templates | validate stage-folder templates + skill frontmatter under src/skills/ | package.json, bin/validate-templates.ts |
| npm run deploy | node bin/deploy-to-agent.ts | package.json |
| npm run deploy:smoke | deploy to .tmp/agent with --clean + CLI smoke test | package.json |
| npm run sdlc | run the CLI from source | package.json |
| node bin/lint-artifact.ts | lint an artifact through the same validateArtifact path | bin/lint-artifact.ts |
| node bin/deploy-to-agent.ts --dest <root> [--platform <id>] [--platform-version <n>] [--clean] [--skip-smoke] | deploy both skills + rendered agents to a destination agent root | bin/deploy-to-agent.ts |
| sdlc requirements --change <name> --record-answers <file> | batch-record discovery answers from a YAML array of {lens, question, answer} entries in one call (stage must provide the recordAnswer hook) | src/scripts/lib/kinds/authoring.ts |
| sdlc implementation --change <name> --task-id <id> --status done --note "<note>" | mark a task done; the transition is rejected at write time without a non-empty note (TASK_DONE_REQUIRES_NOTE) | src/scripts/lib/kinds/tasks.ts, src/policies/errors.yaml |

## Environment

| Variable | Purpose | Required? | Evidence |
|----------|---------|-----------|----------|
| (none) | No .env.example or docker-compose in repository; no environment variables declared | — | package.json, repository root |

## Testing

| Test Command | Coverage Tool | Evidence |
|--------------|---------------|----------|
| npm test (node --test) | none configured | package.json |
| npm run test:unit | none configured | package.json |
| npm run test:e2e | none configured | package.json |

## Deployment

| Target | Command/Trigger | Evidence |
|--------|-----------------|----------|
| Agent root (default .opencode) | npm run deploy / node bin/deploy-to-agent.ts --dest <root> [--platform <id>] [--platform-version <n>] | package.json, bin/deploy-to-agent.ts |
| Smoke target .tmp/agent | npm run deploy:smoke (dest .tmp/agent, --clean) | package.json (scripts.deploy:smoke) |
| Payload | two self-contained skills: agentic-sdlc (SKILL.md + bundled scripts/sdlc.js + stages/ + schemas/ + policies/) and knowledge-init (SKILL.md + manifest.json); six agents rendered into <dest>/agents/<agent-id>.md via the selected platform renderer (default opencode, latest version); --clean removes both skills first and stale rendered agents whose source definitions no longer exist | bin/deploy-to-agent.ts, AGENTS.md §10 |
| Rendered agent frontmatter | carries the invocation mode (omitted → all) beside model and temperature plus the per-agent question tool grant (allow on requirements-analyst, deny on the other five); verified by the existing smoke checks | src/scripts/lib/deploy/platforms/opencode.ts, src/agents/ |
| Smoke coverage | agentic-sdlc CLI --list-workflows run + knowledge-init SKILL.md frontmatter check (name equals folder, description non-empty) + per-agent check (frontmatter parses, filename stem matches agent id); report carries skills and agents arrays plus platform and platformVersion | bin/deploy-to-agent.ts |

- No CI config found. Evidence: no .github/ in repository root.