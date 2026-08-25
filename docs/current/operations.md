# operations.md

## Commands

| Command | Purpose | Evidence |
|---------|---------|----------|
| npm run validate | schemas + policies + templates (incl. skill frontmatter) + typecheck + tests | package.json (scripts.validate) |
| npm run check:all | test:all (validate + unit + e2e) + deploy smoke | package.json (scripts.check:all) |
| npm run test:all | validate + unit + e2e | package.json |
| npm test | node --test over unit + e2e | package.json (scripts.test) |
| npm run test:unit | unit tests only | package.json |
| npm run test:e2e | end-to-end tests only | package.json |
| npm run typecheck | tsc --noEmit | package.json |
| npm run build | tsup bundle of src/scripts/sdlc.ts → dist/ | package.json, tsup.config.ts |
| npm run validate:schemas | validate schema assets | package.json |
| npm run validate:policies | validate errors.yaml + stage folders (descriptors, checks, steps, schemas) | package.json, bin/validate-policies.ts |
| npm run validate:templates | validate stage-folder templates + skill frontmatter under src/skills/ | package.json, bin/validate-templates.ts |
| npm run deploy | node bin/deploy-to-agent.ts | package.json |
| npm run deploy:smoke | deploy to .tmp/agent with --clean + CLI smoke test | package.json |
| npm run sdlc | run the CLI from source | package.json |
| node bin/lint-artifact.ts | lint an artifact through the same validateArtifact path | bin/lint-artifact.ts |
| node bin/deploy-to-agent.ts --dest <root> [--clean] [--skip-smoke] | deploy both skills to a destination agent root | bin/deploy-to-agent.ts |

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
| Agent root (default .opencode) | npm run deploy / node bin/deploy-to-agent.ts --dest <root> | package.json, bin/deploy-to-agent.ts |
| Smoke target .tmp/agent | npm run deploy:smoke (dest .tmp/agent, --clean) | package.json (scripts.deploy:smoke) |
| Payload | two self-contained skills: agentic-sdlc (SKILL.md + bundled scripts/sdlc.js + stages/ + schemas/ + policies/) and knowledge-init (SKILL.md + manifest.json); --clean removes both first | bin/deploy-to-agent.ts, AGENTS.md §10 |
| Smoke coverage | agentic-sdlc CLI --list-workflows run + knowledge-init SKILL.md frontmatter check (name equals folder, description non-empty); report carries a skills array with per-skill results | bin/deploy-to-agent.ts |

- No CI config found. Evidence: no .github/ in repository root.