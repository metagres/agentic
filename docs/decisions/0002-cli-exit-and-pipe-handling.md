# 0002 — `sdlc` exits via `process.exitCode`; uncaught failures map to 9; EPIPE is not a failure

- Status: accepted
- Date: 2026-09-23
- Scope: `packages/sdlc/src/cli/sdlc-cli.ts` exit handling
- Normative refs: `docs/current/specification.md` §19.1 (exit table; exit 1
  reserved), §19.4 (atomicity); `docs/plans/P-02-cli-runtime-skeleton-and-common-protocol.md`

## Context

The P-02 entry called `process.exit()` on every terminal path. Node forces
exit before pending asynchronous I/O completes, and stdout/stderr writes to
pipes and files are asynchronous: output can be truncated under a slow
consumer. Machine-readable stdout is this CLI's contract (§19.1, §20.6 agent
tooling), so the truncation hazard sits directly on the contract.

Separately, moving exit to natural drain makes post-`run()` failures
reachable, and Node's default exit for an uncaught exception is 1 — a code
§19.1 reserves.

## Decision

1. The entry never calls `process.exit()`. Terminal paths return the exit
   code; the top level assigns it to `process.exitCode` and the process
   drains and exits naturally. Exit codes and envelope shapes are unchanged
   (contract tests stayed frozen through this migration).
2. `uncaughtException` / `unhandledRejection` handlers write the
   INTERNAL_ERROR envelope and map to exit 9, keeping "1 is reserved" true
   outside the synchronous `run()` window (P-02 exit table).
3. EPIPE (`sdlc --help | head`) is a closed reader, not a failure: stream
   error handlers swallow it and the already-decided exit code stands. A
   non-EPIPE stream error is rethrown into the uncaught-failure path (exit 9).

## Consequences

- A non-EPIPE uncaught failure no longer aborts mid-write; the process
  drains instead. State-changing commands must keep writes atomic (§19.4),
  since an exception no longer implies immediate process death.
- EPIPE never changes a decided exit code, so `sdlc frobnicate | head` still
  exits 2; swallowing EPIPE only prevents a broken pipe from manufacturing a
  failure code of its own.
