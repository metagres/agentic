# P-17 — Agents, skills, and command assets

P-17

### Goal
Author deployed OpenCode agents, skills, and the optional `/sdlc-next` command.

### Deliverables
- Agents:
  - `coordinator.md`
  - `author.md`
  - `stage-reviewer.md`
  - `archiver.md`
- Permission matrix implementation:
  - coordinator: allowed subagents `author`, `stage-reviewer`, `archiver`; denied `sdlc_approve`, `sdlc_abandon`, arbitrary shell, arbitrary subagents;
  - author: read, edit code, `sdlc_write`, `sdlc_raise_upstream`; denied approve/abandon/amend/reviewer tools;
  - stage-reviewer: read, `sdlc_write`, `sdlc_raise_upstream`; denied project-file edits and approve/abandon/amend;
  - archiver: read, edit only under `docs/current/`, `sdlc_archive`; denied code edits, approve/abandon/amend.
- Skills:
  - `qna/SKILL.md`
  - `work-item-scaffold/SKILL.md`
  - `archive-work-item/SKILL.md`
- Optional command:
  - `commands/sdlc-next.md`

### Testable acceptance criteria
- Assets validate against the pinned OpenCode config schema discovered in P-00.
- Lint tests assert deny lists include `sdlc_approve` and `sdlc_abandon` for all agents.
- Coordinator subagent allow list contains exactly the three permitted subagents.
- Reviewer denies file-edit permissions.
- Archiver path restriction is expressed explicitly.

### Dependencies
- P-00.
- P-16 for tool names.
