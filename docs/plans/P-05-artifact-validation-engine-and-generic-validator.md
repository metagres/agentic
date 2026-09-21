# P-05 — Artifact schema validation engine and generic validator

P-05

### Goal
Implement mechanical validation as a pure function over provided data.

### Deliverables
- JSON Schema validation for stage artifacts, `workflow.json`, upstream issues, approvals, and archive metadata.
- Generic validator checks:
  - workflow stage IDs exist;
  - workflow ends in terminal stage;
  - stage appears at most once;
  - review target earlier than review stage and is author stage;
  - rework target exists;
  - artifact inputs exist and precede consumers;
  - `based_on` entries resolve and are not newer than source revisions;
  - artifact revisions monotone;
  - registry/config snapshot hash valid;
  - required artifact metadata present;
  - review checklist fully answered;
  - `gate_cleared == findings.length == 0`;
  - unique IDs;
  - referenced check IDs exist;
  - supersedes chains contain no cycles.
- Finding schema:

```json
{
  "code": "...",
  "severity": "blocking",
  "stage": "...",
  "implicated_stage": "...",
  "path": "...",
  "message": "..."
}
```

- Explicit separation: lifecycle conditions are not validator findings.

### Testable acceptance criteria
- Fixture tests cover every check in `specification.md §26`:
  - dependency cycle;
  - dangling reference;
  - revision inversion;
  - stale `based_on`;
  - invalid stage ID;
  - review targeting later stage;
  - invalid registry/config snapshot.
- Validator is pure: no filesystem imports.

### Dependencies
- P-04.
