# P-21 — Phase 2: workflow graph, review depth, and multiple workflows

P-21

### Goal
Prove data-driven workflows under richer conditions.

### Deliverables
- Multiple workflow templates.
- Custom stage arrays not present in `workflows.yaml`.
- Two concurrent live work-items with different workflows.
- Full `based_on` revision cascade tests.
- Graph validator tests:
  - cycles;
  - orphans;
  - dangling references;
  - stale revisions.
- Review round cap behavior.
- Workflow amendment before and after freeze.
- Apply ISSUE A resolution once decided.

### Testable acceptance criteria
- Changing stage names in config requires no CLI code change.
- Two work-items derive state independently.
- Stale downstream artifacts are detected.
- Amendment validation rejects non-terminal final stage.
- Round cap block and recovery path behave according to the resolved ISSUE A decision.

### Dependencies
- P-20.
- ISSUE A resolution.
