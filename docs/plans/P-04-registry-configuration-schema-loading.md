# P-04 — Registry, configuration, schema, and checklist loading

P-04

### Goal
Implement loading and validation of all registry/config data and compute the registry hash.

### Deliverables
- Loaders for:
  - `config.yaml`
  - `stages.yaml`
  - `types.yaml`
  - `workflows.yaml`
  - `checks/generic/*.yaml`
  - `checks/schemas/*.yaml`
  - `schemas/*.json`
  - `templates/*.md`
- Registry validation:
  - actor enum: `author`, `stage-reviewer`, `script`;
  - completion mode enum: `artifact`, `review_gate`, `terminal`;
  - review stage must declare target, checklist, rework target;
  - review target must not be itself;
  - terminal `script` stage must declare supported `terminal.command` and `completion_file`;
  - workflow templates must reference registered stages and end in terminal stage;
  - types must resolve to `types.yaml`.
- Registry snapshot hash computation covering:
  - `stages.yaml`
  - `types.yaml`
  - schemas participating in validation
  - checks participating in validation

### Testable acceptance criteria
- Unit tests accept valid registries and reject malformed registries with precise findings.
- Registry hash is deterministic.
- Changing a schema or checklist changes the hash.
- Changing a prompt template does not change the hash, unless you later decide templates are registry-covered.

### Dependencies
- P-01.
