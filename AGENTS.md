# AGENTS.md — Mandatory Rules for AI Coding Agents

## 1. The One Rule

Any change touching code or YAML (`src/`, `bin/`, `*.ts`/`*.js`, `package.json`,
`tsconfig.json`, `tsup.config.ts`, any `*.yaml`) is complete only when
`npm run validate` passes. If it fails, the work is not done — no exceptions.
Documentation-only changes (`*.md`, codemaps) are exempt. For full confidence run
`npm run check:all`. Command semantics: docs/current/operations.md.

## 2. Invariants

Invariant numbering is stable — docs/current cites these rules by number. Never renumber.

1. Authoring stages produce delta entries; `docs/current/` is written only by knowledge extraction.
2. The toolkit is agent-agnostic — no hardcoded agent paths.
3. Deployed skills and agents under `.opencode/` are build artifacts — never edit them, never treat them as source.
4. Validation is declarative: stages declare named checks from the capped catalog; stage-specific validation scripts are prohibited. Adding or changing a check is a design-review event — the catalog in `src/scripts/lib/checks/index.ts` is the single extension path and is never restated elsewhere.
5. A new check type, error code, or ID prefix updates its catalog (`src/policies/errors.yaml` or the stage folder) and adds a test.
6. Codemap files are generated documentation — update them only via the codemap skill, never by hand.
7. Stage lifecycle commands execute through the deployed CLI (`.opencode/skills/agentic-sdlc/scripts/sdlc.js`), never through `src/` scripts. After any change to stage, agent, schema, or policy sources, refresh the production runtime: `npm run deploy -- --dest .opencode --clean`.
8. AGENTS.md carries only always-in-force rules. Descriptive or drift-prone content — commands, shapes, counts, layouts, enumerations — belongs in docs/current/, lands via knowledge-extraction deltas, and cites the owning source file instead of restating it.

## 3. Definition of Done

- The One Rule (§1) is satisfied and no invariant (§2) is violated.
- No hardcoded agent-specific paths were added.
- Deployment-related changes: `npm run deploy:smoke` passes.
- Behavior changed: docs updated (§2 governs how).

## 4. Session Context Routing

docs/current/ is the default destination for descriptive content; this file is the
exception (§2). Start every session from docs/current/index.md and load
only what the session goal needs. When the codegraph MCP is available in the
runtime, use `codegraph_explore` as the first stop for code exploration
(structure, call paths, impact) instead of grep/read loops. Terminology
(stage/kind/gate/step/state/status): docs/current/glossary.md.

| Session goal | Read |
|---|---|
| Commands, tests, deploy, verification | docs/current/operations.md |
| CLI flags, envelope fields, command shapes | docs/current/api-contract.md |
| YAML entities and field shapes (stage.yaml, agents, envelope, tasks, rounds) | docs/current/glossary.md |
| Folder layout, tech stack, boundaries, validation layers | docs/current/architecture.md |
| Code patterns, naming, error handling, file organization | docs/current/conventions.md |
| Why something is designed this way | docs/current/decisions.md |
| Features, workflows, SDLC goals canon | docs/current/capabilities.md |
| Library versions and roles | docs/current/dependencies.md |
| Known defects and markers | docs/current/known-issues.md |
| Where a file or symbol lives | codemap.md (root; per-folder codemaps for deep work) |
