# P-07 — CLI facade: `getWorkItemState`

P-07

### Goal
Implement the I/O facade that assembles derivation input and delegates to the pure core.

### Deliverables
- Resolve repository root and work-item location.
- Detect `docs/work-items/done/` and return `done` without invoking the pure core.
- Load:
  - `workflow.json`
  - registry snapshot recorded by the work-item
  - artifacts
  - review artifacts
  - upstream issues
  - approvals
  - terminal completion evidence
- Verify installed registry hash matches recorded hash.
- Return `uninitialized` when `workflow.json` is absent.
- Read-only behavior.

### Testable acceptance criteria
- Facade/core parity tests exercise both against the same fixtures.
- Facade returns `done` only for items under `done/`.
- Registry hash mismatch returns `invalid`.
- Missing `workflow.json` returns exact `uninitialized` object.
- Integration test proves the command writes nothing.

### Dependencies
- P-04, P-06.
