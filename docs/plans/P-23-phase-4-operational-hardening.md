# P-23 — Phase 4: operational hardening

P-23

### Goal
Complete v1 operational readiness and acceptance criteria.

### Deliverables
- Approval checkpoint end-to-end tests.
- Hotfix workflow fixture per `implementation.md Appendix B`.
- Living-document update flow via archiver skill.
- Large-repository performance tests.
- Installation hardening:
  - shadowed installs;
  - force overwrite;
  - manifest drift.
- Approval-path and abandonment-path smoke tests.
- Full `specification.md §26` definition-of-done matrix.

### Testable acceptance criteria
- Checkpoint blocks write until approval.
- Stale approval blocks again.
- Hotfix workflow completes without CLI code change.
- Archiver updates only `docs/current/`.
- Performance targets from implementation acceptance criteria pass.
- All definition-of-done items have named tests.

### Dependencies
- P-22.
