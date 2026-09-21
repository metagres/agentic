# P-20 — Phase 1 vertical slice: neutral end-to-end workflow

P-20

### Goal
Prove the whole system end-to-end using deliberately neutral stage names.

### Deliverables
- Phase 1 registry and workflow fixture using:
  - `define`
  - `build`
  - `build-review`
  - `release`
- End-to-end scripted scenario:
  1. scaffold;
  2. write define artifact;
  3. freeze;
  4. write build artifact;
  5. review build;
  6. rework if needed;
  7. clear gate;
  8. archive;
  9. verify done state.
- Cold-resume test:
  - interrupt after each step;
  - rerun `get-work-item-state`;
  - derive same next action.
- OpenCode delegation smoke:
  - coordinator invokes author and stage-reviewer;
  - tools appear;
  - permissions deny human operations.

### Testable acceptance criteria
- No stage named `requirements` is used.
- CLI-only end-to-end passes.
- Cold resumption passes after every step.
- OpenCode smoke passes in pinned release.
- All writes are atomic or journaled.
- Source-to-deployment parity passes.

### Dependencies
- P-08, P-09, P-10, P-14.
- P-16 and P-17 for OpenCode smoke.
- P-00.
