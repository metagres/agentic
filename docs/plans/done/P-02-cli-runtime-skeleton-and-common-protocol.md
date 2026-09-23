# P-02 — CLI runtime skeleton and common protocol

P-02

### Goal
Establish the shared CLI runtime used by all commands.

### Deliverables
- Command parsing layer under `packages/sdlc/src/cli/` (package-relative `src/cli/`).
  - `sdlc-cli.ts` is entry point only: argument routing, I/O, exit. It dispatches through the command registry (`commands.find((command) => command.matches(args))`); registry order is precedence.
  - Command logic lives in separate modules (e.g. `commands/<name>.ts` plus shared `protocol.ts` for envelope/exit codes). No business logic in the entry point. Each command module exports exactly one `CliCommand`: `descriptor` (name, parameters/arguments, description, usage example) + `triggerFlags` (flags it claims) + `matches(args)` claiming raw argv + `run(ctx)` executing its unique logic and returning the stdout payload. Adding a command is one module plus one registry line; the entry point is untouched. Import from the defining module; `commands/index.ts` is registry-only, not a barrel.
  - Cross-cutting output modifiers (`--human`) are declared once as `GLOBAL_FLAGS` in `protocol.ts` for flag validation. Rendering is resolved per command from argv via the shared `isHuman()` helper; the entry point never interprets it. The command context is `{ args, commands }`: raw argv as the single source plus the registry for meta-commands such as help (most commands ignore `commands`; the uniform shape stays stable as the §19.2 set lands).
  - Minimal commands: `--version` and `--help` (plus unknown-command and bad-flag handling).
  - `--version` outputs JSON by default (e.g. `{"name":"@agentic/sdlc","version":"0.1.0"}`), exit 0. With `--human` it prints only the version string (e.g. `0.1.0` + newline).
  - `--help` outputs a JSON command descriptor by default (e.g. `{"commands":[{"name":"...","description":"...","usage":"...","example":"..."}]}`), exit 0. With `--human` it prints the human-readable command list with meanings.
  - Each command module is self-describing: it exports its name, parameters/arguments, description, and a usage example. `--help` renders both JSON and human text from these descriptors; adding a command with a descriptor automatically extends help.
- Machine-readable JSON output by default; `--human` requests human-readable stdout rendering. Stderr error envelope stays JSON.
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

- Exit codes are process numbers (technically required) per `specification.md §19.1`; `error.code` is an UPPER_SNAKE name. P-02 keeps the spec table verbatim — no renumbering to 0,1,2 without a spec amendment:
  - 0 success
  - 1 reserved, never emitted explicitly (documents the spec gap; Node's default uncaught exit is remapped to 9)
  - 2 invalid invocation
  - 3 repository/configuration error
  - 4 authorization/approval failure
  - 5 current-state conflict
  - 6 validation failure
  - 7 gate closed or workflow blocked
  - 8 recovery required
  - 9 internal error (including uncaught failures)

### Testable acceptance criteria
- Contract tests assert: `--version` JSON with `version` field (exit 0) and `--human` raw string; `--help` JSON descriptor listing all registered commands (exit 0) and `--human` readable list; unknown commands / bad flags emit the error envelope to stderr with exit 2; internal errors emit the envelope with exit 9. Missing-repository handling is deferred to P-03.
- No command writes to stdout in a non-JSON format unless `--human` is requested.
- Structural tests assert `sdlc-cli.ts` is routing-only (command logic in separate modules) and every command module exports name, parameters/arguments, description, and usage example consumed by `--help`.

### Dependencies
- P-01.
