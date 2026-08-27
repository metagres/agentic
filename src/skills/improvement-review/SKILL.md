---
name: improvement-review
description: Development-only re-run of the six-step SDLC improvement review against live dogfooding evidence. Instruments sessions, measures artifacts and envelope sizes with bundled deterministic helpers, mines caller-supplied transcripts, classifies gates, inventories unused surface, converts evidenced findings into docs/ideas proposals in the nine-section format with a governance test, and refreshes the playbook's goals list, findings register (with a What-worked fairness subsection), and dated measurement baselines. Invoked manually by the maintainer; never deployed.
inputs:
  - docs/ideas/sdlc-improvement-review-playbook.md (method, SDLC goals list, findings register, current baselines)
  - docs/changes/<slug>/ artifacts for every change in scope
  - src/ engine source (src/scripts/, bin/, src/stages/) for consumer checks
  - AGENTS.md and docs/current/ for grounding and governance screening
  - Session transcripts explicitly supplied by the maintainer (optional; never discovered)
outputs:
  - Refreshed playbook sections: SDLC goals list, Findings register with What-worked subsection, Current baselines
  - docs/ideas/<slug>.md proposals in the nine-section format, each carrying a governance-test result
  - Measurement records from the four bundled helpers with command and date recorded beside every number
---

# Improvement Review (Dev-Only)

Manual re-run of the review-and-proposal exercise that produced the process-economy reform,
operationalized from `docs/ideas/sdlc-improvement-review-playbook.md`. This skill is
**development-only**: it is never bundled or deployed, and it changes no engine code — every
outcome lands as playbook state, `docs/ideas/` proposals, or human-reviewable git diff.

## 0. Principles

- **Evidence or label**: every claim carries a measurement, count, grep, or sourced observation —
  or is explicitly labeled an unverified hypothesis naming the missing evidence. Nothing in
  between.
- **Judgment at the call site**: the standing determinism stance. Any proposal that would place
  judgment inside the engine is rejected or reshaped here, before kickoff.
- **Fairness**: record what worked alongside what did not. A complaint-only review loses
  credibility and produces worse proposals.
- **Loud abort**: a missing playbook or missing anchor stops the review naming the file — never
  review without baselines.
- **Reviewable state**: review state lives in the playbook (goals list, register, baselines),
  which is git-diff reviewable. The skill folder accumulates no run state.

## 1. Preconditions (abort loudly on failure)

1. Locate `docs/ideas/sdlc-improvement-review-playbook.md` relative to the repository root.
   If the file is missing, **stop**: report `missing playbook: docs/ideas/sdlc-improvement-review-playbook.md`
   and run nothing.
2. Verify the playbook carries the three state anchors this review reads and writes:
   `## Findings register`, `## SDLC goals list`, and `## Current baselines`. If any anchor is
   missing, **stop**: name the file and the missing anchor (for example
   `missing anchor '## Current baselines' in docs/ideas/sdlc-improvement-review-playbook.md`)
   and run nothing.
3. **Thin-signal check**: count the substantive changes driven through the toolkit since the
   date of the last findings-register update. If fewer than two, warn that the signal is thin
   and proceed **only after explicit confirmation from the maintainer**; record the warning and
   the confirmation in the register entry produced by this review.

## 2. Goals gate (load or propose the SDLC goals list)

Before any finding is evaluated:

- **List present**: load the stored goals list from the playbook's `## SDLC goals list` section
  and evaluate findings against it.
- **List absent** (the section carries no entries): compose a proposed list and store it, dated,
  in that section before any finding is evaluated. Ground every entry in at least one of:
  AGENTS.md invariants, `docs/current/` capabilities and conventions, agentic-SDLC best practice
  (structured phases with documented continuity so each request carries enough information to
  continue), and dogfooding experience. Entries follow the record format documented in the
  playbook section (id `G-NN`, testable goal statement, grounding sources, status, created date,
  amendments).
- **Amendments** to an existing entry require a dated justification appended to its amendments
  list. Silent rewrites are prohibited.

## 3. Step 1 — Instrumentation (five categories)

Read per-cycle instrumentation notes for every cycle in scope. Each of the five categories must
hold either a recorded value or an explicit **none-observed** marker — an empty category is not
allowed to pass silently:

1. Invocation counts per stage (and per artifact) of the sdlc CLI.
2. Zero-change round-trips (re-reads, repeated finalize attempts, error-and-fix loops).
3. Findings that surfaced later than they could have (review-time discoveries of write-time
   mistakes).
4. Output blocks trimmed, piped, or skipped because they were too large.
5. Delegation outcomes, each recorded with its three sub-fields: the delegation type used, model
   resolution success/failure, and whether the delegated agent's output needed rework.

Cycles without notes are marked **reconstructed-or-missing** in the register entry. Where
transcript files exist for those cycles, fall back to transcript mining (section 5) to
reconstruct what can be reconstructed; mark the rest missing.

## 4. Step 2 — Measurements (four bundled helpers)

Run the helpers from the repository root and record the **command and the date beside every
number** they produce. Compare each number against the newest same-kind baseline row where one
exists. On the first run (no quantitative baseline rows yet), record every helper output as an
**initial-baseline** row — command, date, no delta claim (see section 11). The qualitative prose
baselines in the playbook are authoritative and are never regenerated.

```sh
# Artifact volume per change under docs/changes/ (default <= 40 lines; --verbose for per-file)
node src/skills/improvement-review/scripts/measure_artifacts.ts [--change <slug>] [--verbose]

# Envelope byte sizes for the nine stages (review stages run with mandatory --dry-run)
node src/skills/improvement-review/scripts/envelope_sizes.ts --change <slug> [--verbose]

# Fast-gate duration (shape-stable record; duration_ms varies with machine and load)
node src/skills/improvement-review/scripts/validate_duration.ts [--verbose]
```

Helpers are plain ESM TypeScript executed directly by node with node builtins only — no build
step, no new dependencies. They fail with a named cause and non-zero exit on unreadable input;
zeros are never printed as data. The timing anchor maps as follows: the playbook prose baseline
"`npm run validate`: ~2 s" corresponds to `duration_ms` ≈ 2000 ms — the first initial-baseline
row for validate-duration records kind timing, unit ms, and this prose-to-ms correspondence in
its comparability note. Timing rows compare orders of magnitude and regressions, never bytes.

## 5. Transcript mining (event grammar and degradation)

`mine_transcript.ts` extracts session evidence from **explicitly supplied** files only — it
never discovers transcript stores and contains no hardcoded runtime locations:

```sh
node src/skills/improvement-review/scripts/mine_transcript.ts <file>... [--verbose]
```

The generic line-oriented event grammar it applies (document here if it ever changes):

- **Invocation event**: a line containing an sdlc CLI call — `node <path>/sdlc.ts|sdlc.js ...`
  or a bare `sdlc ...` — counted per command token (the first non-flag argument).
- **Wasted-round candidate**: repeated identical consecutive command lines (trimmed); each
  repeat beyond the first in a run counts once.
- **Delegation event**: a line mentioning delegation that carries sub-field tokens — `type=`
  (delegation type used), `model=` (model resolution success/failure), `rework=` (whether the
  delegated output needed rework). Missing sub-fields are reported as `unrecorded`.

The source filename is printed beside every extracted number. A supplied file with zero
parseable events yields an explicit zero-extraction report naming the file and a non-zero exit —
treat session-derived numbers for that file as **missing**, never as zero. When no transcripts
exist at all, the review degrades by design to instrumentation notes only, with cycles marked
reconstructed-or-missing (section 3); degradation is a designed mode, not an error path.

## 6. Step 3 — Gate classification (proof before classification)

For every declared check and gate, prove it fires against real data before classifying it as
anything other than dead. Proof of execution means a run against real repository data showing
the check/gate actually executing (a fired finding, a recorded round, a measured value) — not a
unit test of the mechanism in isolation.

Classify each into exactly one of:

- **mechanical + early** — enforced at write time by the engine; usually keep.
- **mechanical + late** — enforced, but later than the failure could have been impossible-by-
  construction; candidate for moving earlier.
- **honor-system** — confirmed by self-assessment (for example `--confirm-semantic`); candidate
  for merging into one-call finalize or dropping.
- **dead** — never executes; fix or delete, and say which.

## 7. Step 4 — Unused-surface inventory (grep beside every claim)

For each removal candidate (flags, schema fields, whole workflows, template sections), record
the **exact grep command and its match count** beside the removal claim. A candidate with zero
call-site consumers and zero session usage across multiple cycles is a removal candidate — but
check the full consumer scope before proposing deletion: `src/`, the deployed skills under
`.opencode/skills/`, and other repositories. A candidate with live consumers anywhere in that
scope is excluded or refuted, with the consumer named.

## 8. Findings adjudication (evidence-or-label policy)

Apply the policy to every candidate finding:

- **Evidenced**: carries type (count/grep/timing/observation), value, command, and source.
  Enters the register and may enter a proposal body as fact.
- **Unverified hypothesis**: labeled as such in the register, with `missing_evidence` naming
  what would confirm it. It never enters a proposal body as established fact.
- **Unsupported and unlabelable**: dropped, with the reason noted.

## 9. Step 5 — Proposals (nine-section skeleton)

Convert accepted findings into `docs/ideas/<slug>.md` documents grounded solely on the playbook
Step 6 inline enumeration and the `p12-fast-track-lane.md` exemplar. Each proposal has:

Header table: origin review date plus finding ids · status `proposed` · suggested change slug ·
depends on · kind · **cost tier** — exactly one of `quick win`, `structural`, `strategic`. When
a resolution spans tiers, state the highest required tier and why lower-tier partial resolutions
were rejected.

Then exactly nine H2 sections, in this order:

1. `## Problem`
2. `## Evidence`
3. `## Goal`
4. `## Non-goals`
5. `## Design space & open questions`
6. `## Requirement seeds`
7. `## Implementation sketch`
8. `## References`
9. `## Kickoff (new session)`

A **Governance-test-result** block (section 10) is placed between References and Kickoff, so the
governance flags precede the kickoff command. The kickoff section ends with a runnable command
in the explicit-slug form:

```sh
sdlc requirements --change <judged-slug> --request "…"
```

## 10. Governance test (before kickoff)

Screen every proposal against AGENTS.md invariants and the determinism stance **before** its
kickoff command, and record the test result in the document:

- A proposal placing judgment inside the engine (an LLM, a heuristic call, or a discretionary
  decision inside the CLI) is **rejected or reshaped** to route that judgment to the calling
  agent via flags and data. The reshaping is recorded.
- A proposal touching the capped check catalog flags a **design-review governance event**.
- A proposal touching the frozen CLI envelope flags a **decision governance event**.
- Both flags appear in the Governance-test-result block, ahead of Kickoff.

## 11. Step 6 — Register and baselines refresh

Refresh the playbook in place:

- **Fixed rows**: run a dated regression-check against real data and record the result on the
  row. A regressed row **reopens**, carrying the regression evidence plus a sibling-hunt note
  for newly added surface where the fixed pattern may have reappeared.
- **Open rows**: add a dated progress note.
- **Works rows**: `Works` is the single canonical token for positive confirmations. Every Works
  row carries its dated confirmation as a mandatory `confirmed-working` history entry — positives
  undergo the same dated regression-check discipline as fixes.
- **What-worked fairness subsection**: maintain inside the Findings register with entries of
  mechanism, evidence (measurement, count, or sourced observation), and date. At least one dated
  evidenced entry per completed review; a review with zero fairness entries is **incomplete**
  and must not finalize its register update.
- **Baselines**: append dated measurement rows (id `M-NN`, metric, kind count/bytes/timing,
  value, unit, command, date). First-run rows are marked initial-baseline and claim no delta;
  later runs delta against the newest row of the same metric kind. Whenever a measurement recipe
  changes shape, the new row's comparability note states which prior rows remain comparable.
- **Referential-integrity sweep**: verify every register pointer to a proposal file resolves to
  an existing `docs/ideas/` document. Flag dangling pointers in the round history and correct or
  mark them missing through the register mechanics — never through engine changes.

## 12. Failure paths (summary)

| Failure | Behavior |
|---------|----------|
| Playbook file missing | Abort naming `docs/ideas/sdlc-improvement-review-playbook.md`; run nothing. |
| Playbook anchor missing | Abort naming the file and the anchor; run nothing. |
| Helper input unreadable | Helper exits non-zero naming the path; zeros are never printed as data. |
| Zero parseable events in a supplied transcript | Explicit zero-extraction report naming the file, non-zero exit; session-derived numbers treated as missing for that file. |
| Empty docs/changes dataset | Helpers exit zero reporting an explicit empty result. |
| Measurement recipe shape change | New baseline rows record which prior comparisons remain valid. |

## 13. Scope limits

- Do **not** touch anything under `.opencode/` — it is a build artifact.
- Do **not** change engine code: `src/scripts/`, `bin/`, `src/stages/`, `src/schemas/`, the
  capped check catalog, or the frozen CLI envelope. Findings that would require such changes
  become proposals, not edits.
- Do **not** hardcode agent-specific paths or transcript locations anywhere.
- Do **not** schedule or automate this review; the maintainer invokes it manually when enough
  signal has accumulated (see the playbook's "When to run").
