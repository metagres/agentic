# 0001 — Adopt citty for `sdlc` CLI parsing; keep `@agentic/checks` library-first

- Status: accepted
- Date: 2026-09-22
- Scope: `packages/sdlc` CLI parsing; `@agentic/checks` consumption model
- Normative refs: `docs/current/specification.md` §19 (CLI contract), G9 / PRIN-014 / NFR-008 (single runtime: Node)

## Context

The `sdlc` CLI (`packages/sdlc/src/cli/`) currently hand-rolls argv parsing
(`protocol.ts`, `sdlc-cli.ts`, `packages/checks/src/cli.ts:47`). `protocol.ts`
cites spec G9 (single external runtime dependency is Node) as the reason.
Per AGENTS.md, adopting a library requires proposing the choice with a
recorded decision before adding the dependency.

The CLI contract constrains the choice (§19.1): JSON on stdout by default,
`--human` for text, stderr JSON error envelope, and a fixed exit table
(0, 2–9 with exit 1 reserved and never emitted for `sdlc`). Any framework
covers parsing only; I/O, rendering, TTY gates, and atomic writes stay custom.

## Options considered

| Candidate | Deps | Node floor | Maturity | Verdict |
|---|---|---|---|---|
| hand-rolled (status quo) | 0 | 20 | n/a | viable fallback; owns all parser bugs |
| commander.js v14 | 0, built-in types | >=18 | 28k stars / 113k dependents | acceptable; fights defaults via `exitOverride` + `configureOutput` |
| yargs v18 | 6 (`yargs-parser` et al), separate `@types/yargs` | ^20.19 \|\| ^22.12 \|\| >=23 | 11.5k stars / 41k dependents | rejected: heaviest bundle, strictest Node floor |
| citty v0.2.2 | 0 (native `node:util.parseArgs`), built-in types | 20 OK | 1.3k stars, UnJS-maintained, ~20M weekly dl | **chosen** |
| gunshi 0.26.x | 1 (`args-tokens`) | **v22+ (blocker)** | 469 stars, 0.x, single maintainer | rejected: forces engine bump, immature line, i18n/plugin surface we don't need |

## Decision

1. **Adopt `citty` (pinned exact, currently 0.2.2) for `sdlc` CLI parsing.**
   Rationale: zero dependencies, native-`parseArgs` foundation, and —
   decisive over commander — a headless API (`runCommand` / `parseArgs`
   returning values instead of owning the process) plus `renderUsage()`
   returning a string. That maps cleanly onto the §19.1 protocol:
   JSON-default output, custom `--help` JSON descriptor, and our own
   exit-code mapping with no exit-1 default to suppress.
2. **citty is parsing-only.** Keep the `CliCommand`
   (`descriptor` + `triggerFlags` + `matches` + `run`) registry seam from
   P-02; commands that take options additionally declare a citty `argsDef`
   (typed args). The entry derives the known-flag set from
   `triggerFlags` + `argsDefs` (`collectKnownFlags`) and resolves `--human`
   through citty (`isHuman`); dispatch stays registry-ordered
   `matches`/`run`. Use citty's `parseArgs`/`runCommand` — never `runMain`
   (which owns error handling and process exit). Take over built-in
   `--help`/`-h` and `--version`/`-v` so JSON-by-default holds.
   Unknown-flag rejection stays an explicit entry guard because citty
   parses non-strict (`strict: false`) and silently ignores unknown flags.
3. **Keep JSON-by-default / `--human`.** Flipping to human-by-default
   would save only help/version rendering while invalidating the machine
   contract (§19.1, §19.2, §20.6 agent tools, P-02 tests). Rejected.
4. **G9 reading:** citty ships as a build-time dependency inlined by tsup
   (`noExternal: [/.*/]`, as `packages/sdlc/tsup.config.ts` already does),
   so the deployed CLI remains Node-only at runtime.
5. **`@agentic/checks` stays library-first; its standalone CLI is out of
   scope.** The package's library surface (`checks`, `runCheck`,
   `checkHelp`, `listChecks` via `src/index.ts`) is what the toolkit
   consumes — P-01 and `docs/plans/implementation.md` state
   `@agentic/checks` is bundled via `noExternal` into `dist/bin/sdlc-cli.js`
   and `checks/dist/` is never deployed. The spec's normative CLI (§19) is
   `sdlc` only; no `checks` binary appears in it. The `checks` CLI
   (`src/cli.ts`, exit scheme 0/1/2) remains as a dev/test convenience with
   its hand-rolled parser — do not migrate it to citty now.

## Consequences

- Add `citty` (exact pin) to `packages/sdlc`; record here if the pin moves.
- Rewrite P-02 structure tests to assert the adapter mapping
   (`CliCommand` ↔ citty definitions) instead of hand-rolled matching;
   keep `cli-protocol.test.ts` contract tests green unchanged.
- Prove the pattern with one real §19.2 command (`scaffold`, P-08)
   before the remaining commands (P-09…P-15).
- If citty's 0.x API shifts under us, the `CliCommand` seam contains the
   churn; fallback is hand-rolled parsing behind the same seam.

## Follow-ups

- Migration order: `sdlc` skeleton (`--version`/`--help`/unknown-command/
   bad-flag) first, then `scaffold` as template, then remaining commands.
- Revisit gunshi only if engines move to Node 22+ and it reaches 1.0.
