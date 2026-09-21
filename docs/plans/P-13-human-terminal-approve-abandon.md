# P-13 — Human terminal operations: `sdlc approve` and `sdlc abandon`

P-13

### Goal
Implement approval and abandonment as human-only CLI operations.

### Deliverables
- `sdlc approve <slug> <stage>`:
  - interactive TTY required;
  - stage must be awaiting approval;
  - compute fingerprint from workflow revision and transitive closure of approved stage inputs;
  - compare with stored approval artifact;
  - write `approvals/<stage>.json` atomically;
  - record approver identity from `--approver` or platform identity.
- Approval idempotency:
  - same fingerprint returns existing artifact unchanged;
  - changed fingerprint requires fresh approval.
- `sdlc abandon <slug> --reason <text>`:
  - interactive TTY required;
  - work-item must be live;
  - set persisted status to `abandoned`;
  - write abandonment object;
  - append history;
  - increment workflow revision;
  - idempotent for already-abandoned live work-item;
  - exit 5 for done work-item.

### Testable acceptance criteria
- Non-TTY exits 4.
- Missing approver identity exits 4.
- Stage not awaiting approval exits 5.
- Stale fingerprint exits 5.
- Re-approval of same fingerprint returns identical artifact and unchanged `approved_at`.
- Abandonment updates workflow atomically.
- Re-abandonment is a no-op.
- Done work-item abandonment exits 5.

### Dependencies
- P-03, P-07, P-08.
