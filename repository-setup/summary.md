# Repository Setup Summary

This repository contains the agentic SDLC toolkit.

## Important directories

```text
src/contracts/     Contract checks, source of truth for validation
src/schemas/       JSON Schema files for structural validation
src/policies/      Pipeline, lifecycle, review targets, error and ID catalogs
src/scripts/       CLI implementation
src/templates/     Artifact templates with editor schema hints
bin/               Build, deploy, lint, and validation scripts
test/              Unit, e2e, and contract conformance tests
```

## Common commands

```bash
npm install
npm run validate
npm test
npm run test:unit
npm run test:contracts
npm run test:e2e
npm run check:all
```

## Deployment smoke test

```bash
npm run deploy:smoke
```

Or manually:

```bash
node bin/deploy-to-agent.mjs \
  --dest /tmp/test-agent-root \
  --project-root /tmp/test-project \
  --bundle \
  --clean
```

## CLI utilities

```bash
node src/scripts/sdlc.mjs --list-workflows
node src/scripts/sdlc.mjs doctor
node src/scripts/sdlc.mjs doctor --strict
node src/scripts/sdlc.mjs docs-init
node src/scripts/sdlc.mjs status --dir <change-dir>
```

## Key invariants

- Contracts remain the source of truth for validation.
- Schemas validate structural shape.
- Policies drive pipeline, lifecycle, review targets, and error/ID conventions.
- The CLI envelope is minimal and stable.
- Review history is preserved.
- Living docs are updated through knowledge extraction.
