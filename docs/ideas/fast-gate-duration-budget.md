# The Fast Gate Has No Duration Budget and Has Regressed ~7x

| Field | Value |
|---|---|
| Origin | Improvement-review run of 2026-09-07 (maintainer-invoked), finding E-1; cycle in scope: `agents-working-sdlc-stages-are-too-verbose-in-chat-replies` (instrumentation notes absent — reconstructed-or-missing; reconstructed from 14 maintainer-supplied session transcripts); thin-signal check passed (6 changes with dated activity after 2026-08-28, no maintainer confirmation required) |
| Status | Proposed |
| Suggested change slug | `fast-gate-duration-budget` |
| Depends on | Nothing hard; complements `baseline-measurement-state` (same refresh-the-row mechanism) |
| Kind | Measurement governance + test-suite organization (docs delta + test moves; zero engine behavior change) |
| Cost tier | Structural — the fix requires reorganizing spawn-heavy tests, not a doc edit; a quick-win baseline refresh alone was rejected because it would re-anchor the baseline at the regressed value and bless the drift |

## Problem

The fast gate is the one rule (AGENTS.md §1) and goal G-08 names the AI agent's time as the thing
the SDLC optimizes, but `npm run validate` has no recorded duration budget and has regressed
roughly seven-fold since the baseline was taken. Every stage call, every finalize, every review
round pays this cost many times per change. Nothing in the baselines or the validate scripts
notices the regression; only a manual improvement-review comparison surfaced it.

## Evidence

All numbers carry command and date.

| Metric | Baseline | Fresh | Delta |
|---|---|---|---|
| M-11 validate duration | 2410 ms (2026-08-27, `node src/skills/improvement-review/scripts/validate_duration.ts`) | 16947 ms (2026-09-07, same command, exit 0) | +14537 ms (~7.0x; beyond the same-order-of-magnitude band the row's comparability note contemplates) |
| Qualitative prose baseline | "`npm run validate`: ~2 s" (`docs/current/operations.md` `## Baselines`) | 16.9 s measured | ~8x the prose anchor |
| Unit-suite share | — | tests alone report duration_ms 16023 of the 16947 ms run (npm run validate output, 2026-09-07, 316 tests, 0 fail) | ~95% of the fast gate is the unit suite |

Composition of the regression: the 2026-09-07 validate output shows 28 unit tests each taking
≥500 ms, dominated by CLI process-spawning tests (for example `complete-step --step discovery…`
1017 ms, `a complete all-pass walk is accepted…` 654 ms, `--record-answers persists every batch…`
534 ms, `status pipeline stage entries…` 518 ms). The prior run recorded in
`docs/ideas/baseline-measurement-state.md` measured 2712 ms on 2026-08-28 (+12.5% then, same order
of magnitude); the jump to 16947 ms accumulated with the suite's growth to 316 tests between
2026-08-28 and 2026-09-07. Machine-dependent per M-11's comparability note — the claim is the
order-of-magnitude change, not the exact milliseconds.

**What worked** (fairness note, dated): the gate's function is intact and fast to fail — the
2026-09-07 run executed the full validation stack (schemas, policies including the new
`AGENT_FRAGMENT_COPY` per-agent checks, templates, typecheck, 316 unit tests) in one command with
exit 0, and the change in scope landed with zero mechanical findings surviving to review. The
regression is economy, not correctness.

## Goal

The fast gate's duration is a governed quantity: a recorded budget row exists, the suite's
spawn-heavy tests no longer dominate it, and a future regression beyond the budget is visible in
the gate's own output rather than only in a manual review.

## Non-goals

- No change to what the fast gate covers (schemas + policies + templates + typecheck + unit
  tests stay; e2e stays in `check:all`).
- No engine or CLI behavior change; no new envelope fields.
- No flakiness or assertion changes in existing tests — only where they run and how they spawn.
- No timing enforcement inside the engine (no wall-clock gate in the CLI — that would be a
  judgment-free but environment-dependent failure surface; the budget lives in docs and the
  measurement recipe).

## Design space & open questions

- **(a) Separate spawn-heavy tier** (recommended): move CLI process-spawning unit tests (the
  ≥500 ms class) behind a distinct npm script (for example `test:cli`) that `check:all` runs and
  `validate` does not, or convert the highest-value ones to in-process invocation of the kind
  interpreters. Fast gate returns to the ~2 s band; coverage is unchanged overall.
- **(b) Keep the suite, record the budget**: add a quantitative baseline row (kind timing, unit
  ms) refreshed by knowledge extraction, and accept the 16.9 s. Cheapest, but concedes the
  agent-time economy G-08 protects and leaves the ~2 s prose baseline false.
- **(c) Parallelize harder**: node --test already runs files concurrently; per-file concurrency
  tuning is machine-dependent and was not measured this run — unverified hypothesis, labeled:
  `missing_evidence` — a concurrency experiment comparing wall time at different
  `--test-concurrency` values on the maintainer's machine.
- Open question: which tests move — by duration threshold, by spawn count, or by an explicit
  allowlist of in-process-safe suites? The kickoff should measure before choosing.

## Requirement seeds

- FR-001: A quantitative baseline row of kind timing for the fast gate exists with a stated
  budget value, recorded by this change's knowledge extraction, replacing (not amending) the
  M-11 comparability situation.
- FR-002: After the change, `npm run validate` on the maintainer's machine completes within the
  recorded budget, measured by `node src/skills/improvement-review/scripts/validate_duration.ts`.
- FR-003: Every test moved out of the fast gate remains executed by `npm run check:all` — no
  test loses its runner.
- NFR-001: Zero changes under `src/scripts/`, `bin/`, `src/stages/` behavior; the validate
  script chain may only re-point which tests run in the fast tier.

## Implementation sketch

1. Measure: run `validate_duration.ts` before and after each move; identify the spawn-heavy
   files (the ≥500 ms class above is the starting list).
2. Move or convert the spawn-heavy tests per design-space (a); keep names and assertions.
3. Knowledge-extraction delta: Modify `docs/current/operations.md` `## Baselines` — refresh the
   timing row with the post-change value and budget, noting the 2026-08-27 → 2026-09-07
   regression in the comparability note.
4. Verify: `npm run validate` within budget; `npm run check:all` green (moved tests still run).

## References

- `docs/current/operations.md` — `## Baselines` M-11 and the `~2 s` prose row (read-verified 2026-09-07)
- `docs/ideas/baseline-measurement-state.md` — the state-column proposal and the 2026-08-28 2712 ms intermediate measurement
- `src/skills/improvement-review/scripts/validate_duration.ts` — the timing helper (command recorded beside every number above)
- `docs/current/capabilities.md` — `## SDLC Goals` G-02 (bounded rounds), G-08 (the agent's time is the currency; the fast gate is the one rule)
- AGENTS.md §1, §8 — the fast-gate contract

## Governance-test-result

- No judgment placed inside the engine: compliant — the budget is a recorded baseline and a
  test-organization change; no wall-clock logic enters the CLI.
- Capped check catalog untouched: no design-review governance event.
- Frozen CLI envelope untouched: no decision governance event.
- Canon mutation path: the timing baseline row is refreshed only through this landing change's
  knowledge extraction — compliant.

## Kickoff (new session)

```sh
sdlc requirements --change fast-gate-duration-budget --request "Restore the fast gate's duration economy: npm run validate regressed from 2410 ms (2026-08-27 baseline M-11) to 16947 ms (2026-09-07), ~95% of it the unit suite dominated by 28 process-spawning CLI tests of ≥500 ms each. Move or convert the spawn-heavy tests so the fast gate returns to the ~2 s order of magnitude while npm run check:all still runs every test, and refresh the timing baseline row with an explicit budget via knowledge extraction."
```
