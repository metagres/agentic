# P-02 — CLI runtime skeleton and common protocol

P-02

### Goal
Establish the shared CLI runtime used by all commands.

### Deliverables
- Command parsing layer under `src/cli/`.
- Machine-readable JSON output by default.
- Optional `--human` output hook.
- Standard error envelope:

```json
{
  "error": {
    "code": "...",
    "message": "...",
    "details": {}
  }
}
```

- Exit-code table implementation:
  - 0 success
  - 2 invalid invocation
  - 3 repository/configuration error
  - 4 authorization/approval failure
  - 5 current-state conflict
  - 6 validation failure
  - 7 gate closed or workflow blocked
  - 8 recovery required
  - 9 internal error

### Testable acceptance criteria
- Contract tests assert exit codes and JSON shape for unknown commands, bad flags, missing repository, and internal errors.
- No command writes to stdout in a non-JSON format unless `--human` is requested.

### Dependencies
- P-01.
