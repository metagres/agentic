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
- All checklist items pass in the pinned OpenCode release.
- Results are recorded in `tests/fixtures/opencode-compat/README.md`.
- Any failed assumption produces a specification amendment request before P-16/P-17/P-18 start.

### Dependencies
- None. This is the first gate.
