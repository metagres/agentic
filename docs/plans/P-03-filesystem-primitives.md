# P-03 — Filesystem primitives: atomic write, locking, transaction journal

P-03

### Goal
Implement the durability layer required by `specification.md §19.4`.

### Deliverables
- Single-file atomic write:
  - write `path.tmp`;
  - fsync file;
  - rename over target;
  - fsync directory where supported.
- Work-item lock file `.sdlc.lock`.
- Transaction journal `.sdlc-txn.json` with:
  - operation ID;
  - intended writes;
  - backups;
  - state `prepared` or `committed`.
- Recovery behavior on CLI startup:
  - `prepared`: restore backups and remove journal;
  - `committed`: complete remaining operations and remove journal;
  - unrecoverable: exit 8.

### Testable acceptance criteria
- Unit tests prove atomic write leaves either old or new content, never partial content.
- Concurrent mutation test proves second mutating invocation fails fast.
- Crash-injection tests:
  - crash after `prepared` restores original state;
  - crash after `committed` completes intended operation.
- Recovery failure exits 8.

### Dependencies
- P-01.
- P-02 for error/exit-code conventions.
