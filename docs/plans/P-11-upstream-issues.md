# P-11 — Upstream issues

P-11

### Goal
Implement raising and resolving upstream issues with caps and supersedes semantics.

### Deliverables
- `sdlc raise-upstream`:

```bash
sdlc raise-upstream <slug> \
  --stage X \
  --target Y \
  --text "..." \
  [--target-revision N]
```

- Validate:
  - target exists;
  - target is earlier;
  - target is author stage;
  - target artifact matches registry;
  - open issue cap from policy snapshot.
- Create `upstream-issues.json` on first use.
- `sdlc resolve-upstream`:

```bash
sdlc resolve-upstream <slug> \
  --issue UP-001 \
  --stage X \
  --artifact <file> \
  --resolution "..."
```

- Resolution:
  - only target stage resolves;
  - resolution and artifact revision happen in one journaled operation;
  - never reopen;
  - support `supersedes`;
  - automatically close superseded open issue;
  - reject cycles.

### Testable acceptance criteria
- Open issue causes derivation to route to earliest target stage.
- Cap counts only open issues.
- Resolving revises target artifact and marks issue resolved atomically.
- Superseding open issue closes old issue with `superseded by ...`.
- Invalid target exits 5.
- Cap exceeded exits 5.

### Dependencies
- P-09.
