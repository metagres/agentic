# P-09 — `sdlc write` for author stages

P-09

### Goal
Implement the only normal path for author machine artifacts.

### Deliverables
- Command:

```bash
sdlc write <slug> <stage> [--file X | --stdin]
```

- Enforce:
  - stage is current;
  - required checkpoint approval exists and is fresh, pending ISSUE B resolution;
  - payload validates against stage schema;
  - caller cannot supply `revision` or `based_on`.
- Compute:
  - next `revision`;
  - `based_on` from declared stage inputs and current upstream artifact revisions.
- Atomic write for normal case.
- Journaled multi-file write when completing the freeze stage:
  - write artifact;
  - set `workflow.json.frozen_at`;
  - same transaction.

### Testable acceptance criteria
- Revision increments monotonically.
- `based_on` matches declared inputs exactly.
- Exit 5 when stage is not current.
- Exit 6 for invalid payload.
- Payload containing caller-supplied `revision` or `based_on` is rejected.
- Freeze test: writing the freeze-stage artifact sets `frozen_at` atomically; crash simulation leaves either both changes or neither.

### Dependencies
- P-03, P-04, P-05, P-07, P-08.
