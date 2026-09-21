# P-22 — Phase 3: architecture, investigation, and schema-specific checks

P-22

### Goal
Support richer stage types without changing the state core.

### Deliverables
- Additional stage definitions:
  - design/architecture-style stages;
  - investigation stages.
- Additional artifact schemas.
- Schema-specific validator checks under `config/checks/schemas/`.
- Richer semantic review checklists under `config/checks/`.
- Stage-specific templates.

### Testable acceptance criteria
- New stages work solely through registry/config additions.
- Schema-specific checks fire only for declaring schema.
- State core source is unchanged by adding these stages.
- Review checklists are fully answered by review artifacts.

### Dependencies
- P-21.
