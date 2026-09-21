# P-12 — `sdlc amend-workflow`

P-12

### Goal
Implement controlled workflow amendment before and after freeze.

### Deliverables
- Command:

```bash
sdlc amend-workflow <slug> \
  --stages <json-file> \
  --freeze-after <stage|null> \
  --reason <text> \
  [--type <type>] \
  [--stage <stage-id> | --human]
```

- Pre-freeze `--stage` path:
  - workflow not frozen;
  - `--stage` equals current stage;
  - `--stage` equals `workflow_authoring_stage`;
  - record coordinator identity.
- Human path:
  - interactive TTY required;
  - allowed before or after freeze;
  - record human identity.
- Neither `--stage` nor `--human`: exit 2.
- Every amendment:
  - increments `workflow.json.revision`;
  - appends full resulting workflow plus reason to `stage_history`;
  - recomputes registry snapshot hash;
  - validates new workflow, including terminal reachability;
  - uses atomic single-file write for `workflow.json`.

### Testable acceptance criteria
- Authorization matrix tests:
  - wrong stage exits 4 or 5;
  - frozen workflow on non-human path exits 5;
  - missing TTY on human path exits 4;
  - no auth flag exits 2.
- Invalid amended workflow is not written.
- History entry contains full resulting fields.
- Registry hash refresh is recorded.

### Dependencies
- P-04, P-07, P-08.

### Gated item
- Policy snapshot refresh on amendment is gated on ISSUE A.
