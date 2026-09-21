# P-08 — `sdlc scaffold`

P-08

### Goal
Create work-items with immutable `init.md`, versioned `workflow.json`, policy snapshot, and registry hash.

### Deliverables
- Command:

```bash
sdlc scaffold <slug> \
  --type <type> \
  --stages <json-file> \
  --freeze-after <stage|null> \
  --reason <text>
```

- Create:
  - `docs/work-items/<slug>/init.md`
  - `docs/work-items/<slug>/workflow.json`
- Validate before writing:
  - type exists in `types.yaml`;
  - every stage exists in registry;
  - stage sequence is structurally valid;
  - workflow ends in terminal stage;
  - freeze point rules:
    - if `freeze_after` is null, `workflow_authoring_stage` must be null;
    - authoring stage must occur at or before `freeze_after`;
  - duplicate live slug rejected.
- Record:
  - `revision: 1`
  - `status: active`
  - `registry_sha256`
  - `policy_snapshot`
  - initial `stage_history` entry

### Testable acceptance criteria
- Golden-file test for `init.md` and `workflow.json`.
- Exit 0 on success.
- Exit 5 for duplicate live slug.
- Exit 6 for invalid workflow/type/configuration.
- Exit 2 for invalid invocation.
- Non-terminal last stage is rejected.
- Frozen-at-scaffold case produces `frozen_at` and null authoring stage.

### Dependencies
- P-02, P-03, P-04.
