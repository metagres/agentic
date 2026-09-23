# OpenCode compatibility fixture (P-00)

Pinned release under test: `1.18.29` (`opencode --version`, 2026-09-21).
Spec range: `>=1.0.0 <2.0.0`, schema `opencode/v2`.

Throwaway package under `tests/fixtures/opencode-compat/.opencode/`.
Do not import toolkit logic here; probes only.

## Checklist (all must pass before P-16/P-17/P-18)

- [ ] 1. project-local agents load
- [ ] 2. primary can invoke subagents via Task
- [ ] 3. subagent allow-list enforced
- [ ] 4. `.opencode/tools/probe.ts` discovered
- [ ] 5. per-agent allow/deny works (incl. deny pattern)
- [ ] 6. custom command selects agent
- [ ] 7. Node CLI invocable from tool
- [ ] 8. global vs project-local resolution observed
- [ ] 9. `opencode/v2` agent/tool/command shape captured

## Result

Pending manual run in pinned release. Record date, host, and pass/fail per item below.
