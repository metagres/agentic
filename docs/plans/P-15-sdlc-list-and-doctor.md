# P-15 — `sdlc list` and `sdlc doctor`

P-15

### Goal
Implement read-only operational visibility commands.

### Deliverables
- `sdlc list`:
  - discover work-items from filesystem only;
  - derive canonical `WorkItemState` for each live work-item;
  - report `done` for items under `done/`;
  - optional display subtypes derived from active reason;
  - include observation counts where useful.
- `sdlc doctor`:
  - report active installation;
  - report shadowed installations;
  - report registry/config hash mismatches;
  - report OpenCode compatibility status;
  - make no mutations.

### Testable acceptance criteria
- `sdlc list` works with no index file.
- Statuses are canonical `WorkItemState.status` values only.
- `done/` items are reported as done.
- Doctor detects global shadowed by project-local installation.
- Doctor changes no files.

### Dependencies
- P-07.
- Doctor installation awareness depends partially on P-18, but a first version can land earlier.
