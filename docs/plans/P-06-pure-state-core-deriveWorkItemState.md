# P-06 — Pure state core: `deriveWorkItemState`

P-06

### Goal
Implement state derivation as a pure function with no I/O and no stage-name semantics.

### Deliverables
- `DerivationInput` type containing:
  - workflow;
  - registry snapshot;
  - policy snapshot;
  - stage artifacts;
  - review artifacts;
  - upstream issues;
  - approvals;
  - terminal completion evidence.
- `WorkItemState` union per `specification.md §11.5`.
- `ActiveReason` union covering at least:
  - `awaiting_approval`
  - `artifact_absent`
  - `input_stale`
  - `review_absent`
  - `review_stale`
  - `rework_required`
  - `open_upstream_issue`
  - `validator_findings`
  - `terminal_pending`
  - `terminal_recovery_required`
- Derivation precedence per `§11.7`:
  1. missing workflow -> `uninitialized`
  2. invalid workflow/registry/policy -> `invalid`
  3. persisted abandoned -> `abandoned`
  4. blocking structural findings -> `invalid` or earliest implicated stage
  5. open upstream issue -> earliest valid target stage
  6. stage walk using completion modes
  7. checkpoint absent/stale -> active at checkpoint stage
  8. artifact absent -> active at that stage
  9. stale declared input -> active at that stage
  10. review absent/stale -> active at review stage
  11. closed gate with rounds remaining -> active at rework stage
  12. closed gate at cap -> `blocked`
  13. incomplete terminal -> active at terminal stage
  14. terminal evidence but not moved -> `terminal_recovery_required`

### Testable acceptance criteria
- Fixture suite covers every routing case in `specification.md §26`.
- Same fixture with stage renamed from `define` to `specification` produces equivalent state without code change.
- Static test asserts `packages/sdlc/src/lib/state/` imports no filesystem, config, or model modules.
- Static test asserts no forbidden literals in the state core:
  - `requirements`
  - `design`
  - `planning`
  - `implementation`
  - `archive`
- `WorkItemState.stage` is null unless status is `active`.

### Dependencies
- P-05.
