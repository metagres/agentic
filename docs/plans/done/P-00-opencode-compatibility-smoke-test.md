# P-00 — OpenCode compatibility smoke test

P-00

### Goal
Verify the pinned OpenCode version supports all assumptions before building integration layers.

### Deliverables
- A throwaway fixture `.opencode/` package in the pinned OpenCode version.
- Checklist verifying:
  - project-local agents load;
  - primary agent can invoke subagents through Task;
  - subagent permissions restrict available subagents;
  - custom tools under `.opencode/tools/` are discovered;
  - per-agent tool allow/deny permissions work;
  - custom command can select an agent;
  - Node CLI can be invoked from a custom tool;
  - global vs project-local tool resolution behavior;
  - OpenCode config schema shape for agents/commands/tools.

### Testable acceptance criteria
- Pinned release under test: `1.18.29` (detected via `opencode --version` 2026-09-21; satisfies spec range `>=1.0.0 <2.0.0`, `opencode/v2`).
- All checklist items pass in the pinned OpenCode release.
- Results are recorded in `tests/fixtures/opencode-compat/README.md`.
- Any failed assumption produces a specification amendment request before P-16/P-17/P-18 start.

### Probe matrix (maps 1:1 to fixture + integration test)
1. project-local agents load (`agents/coordinator.md`, `agents/author.md`);
2. primary agent can invoke subagents through Task;
3. subagent permissions restrict available subagents;
4. custom tools under `.opencode/tools/` are discovered (`tools/probe.ts`);
5. per-agent tool allow/deny permissions work (incl. deny `sdlc_approve`/`sdlc_abandon` pattern);
6. custom command can select an agent (`commands/probe.md`);
7. Node CLI can be invoked from a custom tool (`node dist/tools/sdlc/bin/sdlc-cli.js --version`);
8. global vs project-local tool resolution behavior observed;
9. OpenCode config schema shape for agents/commands/tools captured in `opencode.jsonc`.

### Commands
```sh
opencode --version
npm test --workspace @agentic/sdlc -- opencode-compat
```

### Blocks
- P-16, P-17, P-18.

### Dependencies
- None. This is the first gate.
