# P-01 — Canonical source repository scaffold and build pipeline

Status: approved + implemented (scaffold). Pinned OpenCode: `1.18.29`. Spec: `§5.1-2/8`, `NFR-003/008/012`.

### Goal
Create the canonical source tree and a deterministic build that produces the deployable payload.

### Canonical decision (approved 2026-09-22)
- Single main package `packages/sdlc/` sibling to `packages/checks/` (no further splits in v1).
- `@agentic/checks` bundled via `noExternal` into `dist/bin/sdlc-cli.js`; `checks/dist/` never copied.
- Thin adapter `packages/sdlc/src/adapter/sdlc.ts` → `dist/tools/sdlc.ts` passthrough only (P-16).
- Root `package.json` stays a private workspace orchestrator (`>=20`, `npm --workspaces test/build`).

### Deliverables (scaffold)
- `packages/sdlc/package.json` (`@agentic/sdlc@0.1.0`, `bin:sdlc-cli`, deps `@agentic/checks,yaml`)
- `packages/sdlc/tsup.config.ts` (`entry:src/cli/sdlc-cli.ts`, `esm/node20`, `outDir:dist/bin`, `noExternal:[/.*/]`)
- `packages/sdlc/tsconfig.json` (extends root, `src+test`)
- `packages/sdlc/src/{cli,lib/{state,fs},config,adapter}/` + `test/{unit,integration,parity}/`
- `packages/sdlc/src/cli/sdlc-cli.ts` P-01 stub (`--version` → 0, else stderr envelope → exit 2)
- Root fixes: stale `bin:src/scripts/sdlc.ts` removed, `engines>=20`, `test/build` via workspaces, `tsconfig.include` → `packages/*/src+test`
- Full `dist/tools/sdlc/{bin/sdlc-cli.js,manifest.json,...}` payload + manifest hash deferred to P-01b/P-19 (after P-02 CLI + P-04 config land).

### Deliverables
- Repository layout per `implementation.md §3`, rooted at `packages/sdlc/` per the canonical decision above:
  - `packages/sdlc/src/cli/`
  - `packages/sdlc/src/lib/`
  - `packages/sdlc/src/config/`
  - `packages/sdlc/src/agents/`
  - `packages/sdlc/src/skills/`
  - `packages/sdlc/src/commands/`
  - `packages/sdlc/src/adapter/`
  - `packages/sdlc/test/`
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
