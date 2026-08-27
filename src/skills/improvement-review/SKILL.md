---
name: improvement-review
description: "Development-only re-run of the six-step SDLC improvement review against live dogfooding evidence. Instruments sessions, measures artifacts and envelope sizes with bundled deterministic helpers, mines caller-supplied transcripts, classifies gates, inventories unused surface, and converts evidenced findings into docs/ideas proposals in the nine-section format with a governance test. Pure advisor — reads the SDLC goals canon (docs/current/capabilities.md) and the baselines (docs/current/operations.md) read-only and writes only docs/ideas proposals. Invoked manually by the maintainer; never deployed."
inputs:
  - docs/current/capabilities.md ("## SDLC Goals" canon) — read-only
  - docs/current/operations.md ("## Baselines") — read-only
  - docs/changes/<slug>/ artifacts for every change in scope
  - src/ engine source (src/scripts/, bin/, src/stages/) for consumer checks
  - AGENTS.md and docs/current/ for grounding and governance screening
  - Session transcripts explicitly supplied by the maintainer (optional; never discovered)
outputs:
  - docs/ideas/<slug>.md proposals in the nine-section format, each carrying a governance-test result and a Status header field carrying the disposition with a date
  - Measurement records from the four bundled helpers with command and date recorded beside every number
---

# Improvement Review (Dev-Only)

Manual re-run of the six-step review-and-proposal exercise that produced the process-economy
reform. This skill is **development-only**: it is never bundled or deployed, and it changes no
engine code. It is a **pure advisor**: it reads the goals canon and baselines in `docs/current/`
read-only and its only write surface is `docs/ideas/` — every outcome lands as a
`docs/ideas/` proposal, a measurement record, or human-reviewable git diff.

## 0. Principles

- **Evidence or label**: every claim carries a measurement, count, grep, or sourced observation —
  or is explicitly labeled an unverified hypothesis naming the missing evidence. Nothing in
  between.
- **Judgment at the call site**: the standing determinism stance. Any proposal that would place
  judgment inside the engine is rejected or reshaped here, before kickoff.
- **Fairness**: record what worked alongside what did not. A complaint-only review loses
  credibility and produces worse proposals.
- **Loud abort**: a missing canon file or missing anchor stops the review naming the file —
  never review without goals or baselines.
- **Canon is read-only**: goals and baselines live in `docs/current/` and are consumed
  read-only; the canon mutates only through changes via knowledge extraction. The skill's only
  write surface is `docs/ideas/`.

## 1. Preconditions (abort loudly on failure)

1. Locate `docs/current/capabilities.md` relative to the repository root and verify it carries
   the `## SDLC Goals` anchor. If the file or the anchor is missing, **stop**: name the file and
   the missing anchor (for example `missing anchor '## SDLC Goals' in
   docs/current/capabilities.md`) and run nothing.
2. Locate `docs/current/operations.md` relative to the repository root and verify it carries the
   `## Baselines` anchor. If the file or the anchor is missing, **stop**: name the file and the
   missing anchor (for example `missing anchor '## Baselines' in docs/current/operations.md`)
   and run nothing.
3. **Thin-signal check**: count the substantive changes driven through the toolkit since the
   last review date (the newest review date recorded in the `docs/ideas/` proposals' Origin
   fields). If fewer than two, warn that the signal is thin and proceed **only after explicit
   confirmation from the maintainer**; record the warning and the confirmation in every proposal
   the run produces (Origin field note) — proposals are the run's only durable output.

## 2. Goals gate (read-only load)

Before any finding is evaluated, load the goals canon from the `## SDLC Goals` section of
`docs/current/capabilities.md` and evaluate findings against it. The canon is never written at
run time; the runtime propose-and-store path is deleted.

- A goal judged **missing** or **amendment-worthy** becomes a `docs/ideas/` proposal in the
  nine-section skeleton (section 9) whose Goal section states the proposed entry in canon format
  (id `G-NN`, testable goal statement, grounding sources, status, created date, amendments).
  The landing change carries the `capabilities.md` delta; the canon mutates only through
  changes via knowledge extraction.
- **Amendments** to an existing entry require a dated justification; silent rewrites are
  prohibited. The amendment travels inside the proposal, never as a canon write.

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

Cycles without notes are marked **reconstructed-or-missing** in the proposal carrying the
affected finding; with zero proposals the mark is reported in the run's output only. Where
transcript files exist for those cycles, fall back to transcript mining (section 5) to
reconstruct what can be reconstructed; mark the rest missing.

## 4. Step 2 — Measurements (four bundled helpers)

Run the helpers from the repository root and record the **command and the date beside every
number** they produce. Compare each fresh number against the **newest same-kind quantitative
row** in the `## Baselines` section of `docs/current/operations.md`. Every proposal's Evidence
section cites the **baseline value, the fresh value, and the delta** for every compared metric.
A metric with **no recorded baseline row** is labeled an **initial-baseline candidate** in the
proposal, for the landing change's knowledge extraction to record. The qualitative prose
baselines in `operations.md` are the authoritative qualitative record and are never regenerated.

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
zeros are never printed as data. The timing anchor maps as follows: the qualitative prose
baseline "`npm run validate`: ~2 s" in `operations.md` corresponds to `duration_ms` ≈ 2000 ms —
the first initial-baseline row for validate-duration records kind timing, unit ms, and this
prose-to-ms correspondence in its comparability note. Timing rows compare orders of magnitude
and regressions, never bytes.

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
  Enters the run's findings adjudication and may enter a proposal body as fact.
- **Unverified hypothesis**: labeled as such, with `missing_evidence` naming what would confirm
  it. It never enters a proposal body as established fact.
- **Unsupported and unlabelable**: dropped, with the reason noted.

## 9. Step 5 — Proposals (nine-section skeleton)

Convert accepted findings into `docs/ideas/<slug>.md` documents grounded on the
`p12-fast-track-lane.md` exemplar (`docs/ideas/p12-fast-track-lane.md`) and the frozen DM-005
proposal-skeleton record in `docs/changes/sdlc-improvement-review-skill/design.yaml` — that
frozen record preserves the original Step 6 enumeration, so no method content is lost. Each
proposal has:

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

## 11. Proposal adjudication and fairness (replaces the register refresh)

- **Proposal-Status adjudication**: every substantiated finding becomes or updates a
  `docs/ideas/<slug>.md` proposal whose Status header field carries the disposition with a
  date, using exactly this vocabulary:
  - `Proposed`
  - `Landed in <change-slug> <YYYY-MM-DD>`
  - `Dropped <YYYY-MM-DD> — <reason>`
  - `Superseded by <slug> <YYYY-MM-DD>`
- **Fairness-in-proposals**: a run that produces proposals must cite at least one
  confirmed-working mechanism with dated evidence inside a proposal — a "What worked" note in
  that proposal's Evidence section. A run with zero substantiated findings writes nothing and
  the duty is vacuous.
- **Write-time referential integrity**: every proposal's References must resolve at write time;
  dangling pointers are fixed before writing — never via engine changes.
- **Unverified hypotheses** stay labeled with `missing_evidence` naming what would confirm them
  and never enter a proposal body as established fact (carried over from section 8 unchanged).

## 12. Failure paths (summary)

| Failure | Behavior |
|---------|----------|
| capabilities.md or its `## SDLC Goals` anchor missing | Abort naming the file and the anchor; run nothing. |
| operations.md or its `## Baselines` anchor missing | Abort naming the file and the anchor; run nothing. |
| Helper input unreadable | Helper exits non-zero naming the path; zeros are never printed as data. |
| Zero parseable events in a supplied transcript | Explicit zero-extraction report naming the file, non-zero exit; session-derived numbers treated as missing for that file. |
| Empty docs/changes dataset | Helpers exit zero reporting an explicit empty result. |
| Measurement recipe shape change | The run marks the delta incomparable in its proposal and proposes a baseline refresh row for the landing change's knowledge extraction. |

## 13. Scope limits

- Write **only** inside `docs/ideas/` — no file outside `docs/ideas/` is created or modified by
  a run; canon updates travel only inside proposals.
- Do **not** edit idea files hosted inside completed change folders (`docs/changes/<slug>/`) —
  they are frozen change artifacts; reference them read-only.
- Do **not** touch anything under `.opencode/` — it is a build artifact.
- Do **not** change engine code: `src/scripts/`, `bin/`, `src/stages/`, `src/schemas/`, the
  capped check catalog, or the frozen CLI envelope. Findings that would require such changes
  become proposals, not edits.
- Do **not** hardcode agent-specific paths or transcript locations anywhere.
- Do **not** schedule or automate this review; the maintainer invokes it manually when enough
  signal has accumulated (section 1 thin-signal check).
