# SDLC Improvement Review — Playbook

Purpose: re-run the review-and-proposal exercise that produced the process-economy reform,
against future sessions, so improvements stay grounded in measured dogfooding rather than
opinion. This document captures the method, the evidence recipes, the analysis lenses, and the
findings register as of 2026-08.

## When to run

- After every 2–3 substantive changes driven through the toolkit (enough signal, still fresh).
- Whenever a session feels long, a gate feels hollow, or a check fires "too late" — those
  irritations are the raw data.
- After any toolkit release that changed the authoring flow (baselines shift; old measurements
  stop being comparable).

## Inputs you need

1. **Session transcripts** of changes run through the toolkit (the primary evidence: counts of
   CLI calls, retries, wasted rounds, delegation failures).
2. **The change artifacts** under `docs/changes/<slug>/` for every change in scope.
3. **The current engine source** (`src/scripts/`, `bin/`, `src/stages/`) to verify which
   fields, checks, and commands actually have consumers.
4. Baselines from the previous review (see §Findings register) so you measure deltas, not
   absolutes.

## Method (six steps)

### Step 1 — Instrument the session while it happens

Do not reconstruct afterwards from memory. During each cycle, note:

- Every CLI invocation and its purpose (creation, recording, update, finalize, review, task
  status). Count them per stage and per artifact.
- Every round-trip that produced no state change (re-reads, repeated finalize attempts,
  error-and-fix loops) — these are the true cost drivers.
- Every finding that surfaced **later than it could have** (review-time discoveries of
  write-time mistakes).
- Every output block you trimmed, piped, or skipped because it was too large.
- Every delegation to a subagent: type used, model resolution success/failure, whether the
  delegated agent's output needed rework.

### Step 2 — Measure the artifacts

Run against `docs/changes/*/`:

```sh
# Volume per artifact
wc -l docs/changes/*/*.yaml | sort -n

# Envelope payload size (repeat for different stages/steps)
node .opencode/skills/agentic-sdlc/scripts/sdlc.js <stage> --change <change> \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(json.dumps(d)), {k: len(json.dumps(v)) for k,v in d.items()})"

# Fast-gate duration (post-reform target: seconds)
time npm run validate
```

Look for:

- **Duplication by design**: structurally required repetition (the old scenarios→AC promotion
  measured 99% text similarity across 20 pairs; the three-phase delta entries overlapped
  heavily). Any place the same content must be authored twice is a finding.
- **Boilerplate fields**: fields present in every authored entry but consumed by nothing
  (past examples: `tasks.complexity`, plan `milestones`/`risks`, stale `metadata.step`,
  never-bumped `version`). Verify "consumed by nothing" with grep over `src/` before claiming it.
- **Artifact growth vs information**: lines-per-decision trend across changes.

### Step 3 — Verify that checks actually execute

The single most valuable trick from the last review: a safety check that silently never runs is
worse than none. For each declared check/gate, prove it fires against real data:

```sh
# Example that exposed the docs-index bug: parser returned 0 documents on the real index
node --experimental-strip-types -e "
import { loadDocsIndex } from './src/scripts/lib/docs-index.ts';
console.log(loadDocsIndex(process.cwd()).length);"
```

Classify every gate into: **mechanical + early** (good), **mechanical + late** (move earlier),
**honor-system** (`--confirm-semantic`, self-assessed clarity — candidates for merging into
one-call finalize or dropping), **dead** (never executes — fix or delete).

### Step 4 — Inventory unused surface

Grep consumers for each candidate: flags (`--describe`, `--describe-step`, `--bump-version`
were unused across four cycles), schema fields, whole workflows (`knowledge-init` skill,
aliases), template sections. A thing with zero call-site consumers and zero session usage in
multiple cycles is a removal candidate — but check external consumers (deployed skills, other
repos) before proposing deletion.

### Step 5 — Convert findings into proposals

For each finding, write: **problem → proposal → expected saving → tradeoff/risk**. Be critical
but fair: record what worked too (frozen envelope enabling scripting, append-only history
surviving mid-cycle requirement changes, directory-scan extensibility delivering zero-engine-
change features). A review that only lists complaints loses credibility.

Structure proposals by cost tier:

- Quick wins (days): enforce-at-write fixes, output slimming, bug fixes, script splits.
- Structural (a change of its own): artifact-model merges, step-tour reshapes, new lanes.
- Strategic (decision first): features without consumers, pipeline topology.

### Step 6 — Feed the proposals back through the toolkit

Write each proposal as a starting document in `docs/ideas/` (see P11/P12 there for the format:
problem, evidence, goal, non-goals, design space with open questions, requirement seeds,
implementation sketch, references, kickoff command). Then implement via normal changes —
dogfooding the reform itself. Prefer explicit slugs now that creation accepts them:

```sh
sdlc requirements --change <judged-slug> --request "…"
```

## Analysis lenses (apply each to every friction point)

1. **Capability match**: would a capable LLM need this scaffold? Gates that count questions or
   demand step-by-step confirmation tax strong agents without catching what matters. Keep
   strictness available for weaker models, but make it opt-in rather than mandatory.
2. **Timing**: could this failure have been impossible-by-construction at write time?
3. **Determinism**: does this decision need judgment (→ caller/LLM) or enforcement (→ engine)?
   The standing rule: judgment at the call site, guardrails in the engine, never an LLM inside
   the engine.
4. **Economics**: tokens and rounds are the currency. Measure bytes per envelope, calls per
   stage, and ask what a human reviewer actually reads.
5. **Consumer test**: who reads this field/instruction/check? "The review might someday" is not
   a consumer.

## Findings register (as of 2026-08)

| # | Finding | Disposition |
|---|---|---|
| F1 | Eight-step authoring tour taxed capable agents; remaining gates were honor-system | Fixed — six-step tour, one-call finalize (P3) |
| F2 | Duplication by design: scenarios→ACs 99% similar; three-phase deltas overlap | Fixed — merged criteria list (P1); aggregator dedupe (P2-lite) |
| F3 | Failures fired late (11 review-time note findings; unnormalized delta errors) | Fixed — write-time enforcement (P4) |
| F4 | Dead weight: complexity/milestones/risks unconsumed; unused flags; inert version | Partially fixed — optionalized (P7); flag inventory still open |
| F5 | Agent layer had no runtime consumer; reviews accepted by the authoring agent | Open — see `p11-agent-delegation-loop.md` |
| F6 | Output/validation economics: fat envelopes; validate ran e2e builds | Fixed — step_help opt-in (P6); validate split (P8) |
| F7 | Cycle granularity ignored change size | Open — manual micro-cycle proved demand; see `p12-fast-track-lane.md` |
| — | Docs-index parser silently returned 0 docs on real data (check never executed) | Fixed (parser + noise filter) during the reform |
| — | Change slugs truncated mid-word | Fixed — word-boundary slugify + explicit slug creation |

When re-running the review: check each "Fixed" row for regression, each "Open" row for
progress, and hunt siblings of each fixed pattern in newly added surface.

## SDLC goals list

Stored record of what the SDLC is currently optimizing for. Loaded at review start, before any
finding is evaluated; later amendments require a dated justification — silent rewrites are
prohibited. This section lives beside the findings register and baselines it is consumed with.

Record format — one ordered entry per goal:

- **id**: `G-NN` (stable two-digit sequence).
- **goal statement**: one testable sentence a review can answer with evidence ("does the current
  toolkit satisfy this?").
- **grounding sources**: at least one of — AGENTS.md section, `docs/current/` file,
  best-practice principle, dogfooding observation.
- **status**: `active` / `amended` / `retired`.
- **created date**: when the entry was first stored.
- **amendments**: list of date + justification pairs (empty on creation).

**Empty state:** no entries exist yet. The first review run proposes the initial dated goals
list — grounded in AGENTS.md invariants, `docs/current/` capabilities and conventions,
agentic-SDLC best practice, and dogfooding experience — and stores it in this section before any
finding is evaluated.

## Current baselines (compare against, don't regress)

- `npm run validate`: ~2 s, unit-only; e2e lives in `check:all`.
- Authoring stages: six steps (`needs_input/init/authoring/ready/complete/recovery`);
  `--finalize --confirm-semantic` completes in one call.
- Requirements: one merged `acceptance_criteria` list (id / GWT / category / parent_id).
- Implementation review: zero blocking findings expected when notes are given at done-time.
- Deltas presented to knowledge-extraction: deduplicated per doc+change.
- Envelope: seven frozen top-level fields; `step_help` only behind `--help-step`.

## Pitfalls

- **Measuring after refactor**: post-reform numbers differ from pre-reform ones; always state
  which baseline you compare to.
- **Confusing ceremony with safety**: before deleting a gate, classify it (Step 3). Honor-system
  gates are deletable; mechanical early gates usually are not.
- **Proposing engine LLM calls**: any proposal that puts a model inside the CLI contradicts the
  toolkit's determinism stance. Route judgment to the calling agent via flags/data instead.
- **Skipping the fairness pass**: a review without "what worked" produces defensive pushback
  and worse proposals.
- **Letting proposals rot**: every proposal leaves this playbook as a `docs/ideas/` document
  with a kickoff command; unowned ideas die here.
