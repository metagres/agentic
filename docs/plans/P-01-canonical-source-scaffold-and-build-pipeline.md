# P-01 — Canonical source repository scaffold and build pipeline

P-01

### Goal
Create the canonical source tree and a deterministic build that produces the deployable payload.

### Deliverables
- Repository layout per `implementation.md §3`:
  - `src/cli/`
  - `src/lib/`
  - `src/config/`
  - `src/agents/`
  - `src/skills/`
  - `src/commands/`
  - `src/adapter/`
  - `tests/`
  - `scripts/build.ts`
  - `scripts/install.ts`
- `npm run build` must:
  - compile TypeScript to JavaScript;
  - copy config, checks, schemas, templates, agents, commands, skills into `dist/`;
  - produce `dist/tools/sdlc/bin/sdlc-cli.js`;
  - produce `dist/tools/sdlc.ts`;
  - write `manifest.json` with toolkit version, supported OpenCode version range, config schema, and build hash.
- Generated-file markers for deployed files.

### Testable acceptance criteria
- `npm run build` succeeds from a clean checkout.
- `dist/` contains every required deployable resource.
- Manifest contains required fields.
- A unit test verifies the build hash is deterministic for unchanged inputs.

### Dependencies
- None, except that the package version and OpenCode version range must be fixed.
