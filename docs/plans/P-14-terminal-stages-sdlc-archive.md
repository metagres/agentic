# P-14 — Terminal stages and `sdlc archive`

P-14

### Goal
Implement terminal completion, archive record validation, and move to `done/`.

### Deliverables
- Command:

```bash
sdlc archive <slug> [--stdin | --file X]
```

- Validate archive record:
  - required frontmatter/metadata;
  - either non-empty `docs_updated` or non-null `no_update_reason`;
  - narrative sections present.
- Verify workflow is otherwise complete.
- Write `archive.md`.
- Move work-item to:

```text
docs/work-items/done/yyyy-MM-dd-HH-mm-<slug>/
```

- Use transaction journal for:
  - writing completion artifact;
  - moving directory.
- Support recovery for `terminal_recovery_required`.

### Testable acceptance criteria
- Incomplete workflow exits 7.
- Invalid archive record exits 2 or 6, according to whether it is invocation or validation failure.
- Crash during archive recovers via journal.
- After success, `getWorkItemState` returns `done`.
- Archive timestamp uses archive operation time.
- Rerunning recovery completes move without duplicating directory.

### Dependencies
- P-03, P-07.
