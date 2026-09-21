# P-19 — Source-to-deployment parity suite

P-19

### Goal
Guarantee deployed files are generated from canonical source and remain in sync.

### Deliverables
- Parity tests comparing canonical resources to deployed resources by content hash.
- Coverage for:
  - agents;
  - skills;
  - commands;
  - config;
  - schemas;
  - checks;
  - templates;
  - CLI bundle;
  - adapter.
- Generated-file marker validation.

### Testable acceptance criteria
- Every canonical resource has a deployed counterpart.
- Content hashes match after build.
- Editing a deployed file directly causes parity failure.
- Missing resource causes parity failure.

### Dependencies
- P-01.
- Complete after P-16, P-17, P-18.
