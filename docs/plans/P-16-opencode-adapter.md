# P-16 — OpenCode adapter: `.opencode/tools/sdlc.ts`

P-16

### Goal
Provide thin OpenCode tool adapters that delegate to the deterministic CLI.

### Deliverables
- Adapter exports:
  - `sdlc_scaffold`
  - `sdlc_get_work_item_state`
  - `sdlc_validate`
  - `sdlc_write`
  - `sdlc_gate`
  - `sdlc_raise_upstream`
  - `sdlc_resolve_upstream`
  - `sdlc_archive`
  - `sdlc_list`
  - `sdlc_amend_workflow`
- Must not export:
  - `sdlc_approve`
  - `sdlc_abandon`
- Resolve CLI relative to adapter installation location.
- Resolve work-item data relative to active target repository.
- No workflow logic in adapter.

### Testable acceptance criteria
- Adapter path-resolution tests distinguish adapter location from repository location.
- Each tool maps to the corresponding CLI command.
- Tool output passes through CLI JSON and exit-code semantics.
- Static test asserts `sdlc_approve` and `sdlc_abandon` are not exported.
- Static test asserts adapter contains no state-derivation logic.

### Dependencies
- P-00.
- P-08 through P-15 for the full tool surface.
- For Phase 1, at least P-08, P-09, P-10, P-14.
