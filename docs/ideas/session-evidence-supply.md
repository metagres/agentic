# Session-Evidence Supply Has No Producer

| Field | Value |
|---|---|
| Origin | Improvement-review run of 2026-08-28 (maintainer-invoked), findings E-7 and E-6 (instrumentation §3, gate classification §6); thin-signal check passed (2 changes since 2026-08-27, no maintainer confirmation required) |
| Status | Proposed |
| Suggested change slug | `session-evidence-supply` |
| Depends on | Nothing hard; complements `review-round-findings` (same durability theme: session facts must land in repo artifacts, not transcripts) and `mine-transcript-delegation-stem` (the miner must be correct before supply matters) |
| Kind | Process/skill-doc amendment (improvement-review SKILL.md + operations baseline row; zero engine change) |
| Cost tier | Quick win |

## Problem

The improvement-review method's Step 1 (instrumentation, five categories) and the transcript-
mining step both depend on session evidence that nothing in the flow produces. Two consecutive
runs now (2026-08-27 original review, 2026-08-28 this run) executed with:

- zero instrumentation notes for every cycle in scope (all marked reconstructed-or-missing),
- zero caller-supplied transcripts (the miner has never consumed a file),
- four of five instrumentation categories `none-observed` (only category 3, late findings, was
  partially reconstructable — from change artifacts, not notes).

The degradation is designed and graceful, but if it is also *permanent*, the review's economics
lens (invocation counts, zero-change round-trips, trimmed output, delegation outcomes) never
closes, and the method's evidence base is permanently thin while appearing rigorous. The
instrumentation contract has an consumer-side spec and no producer-side practice.

## Evidence

All observations dated 2026-08-28 unless noted:

- Baseline row M-12 (`docs/current/operations.md` `## Baselines`): `transcript events — pending`
  since 2026-08-27; the row's own recipe ("run against maintainer-supplied transcript files during
  a review") has never executed.
- Both in-scope cycles (`sdlc-improvement-review-skill`, `rehome-improvement-review-canon`) carry
  no instrumentation notes file or section anywhere under `docs/changes/<slug>/` (directory
  listings, 2026-08-28).
- Instrumentation categories 1, 2, 4, 5: `none-observed` this run. Category 3: one artifact-
  derived instance (FB-001, requirements gap surfaced at design handoff,
  `docs/changes/rehome-improvement-review-canon/feedback.yaml`, 2026-08-27).
- `src/skills/improvement-review/scripts/mine_transcript.ts` — zero invocations with real input
  in repository history (no transcripts exist to mine; M-12 pending).

**What worked** (fairness note, dated): artifact-derived reconstruction did close category 3 and
the gate-classification step without any session evidence — the review-round files
(`docs/changes/*/requirements-review.yaml` etc.) proved the review gate (15 recorded rounds, 4
rejections across repository history) and `required-note-for-status` firing (11 real findings,
`docs/changes/add-agent-agnostic-agent-definitions-deployed-alongside-the-/implementation-review.yaml`)
against real data. The append-only artifact design is itself an evidence source; the proposal
builds on that strength rather than replacing it.

## Goal

Session evidence supply becomes a named, minimal practice with an owner and a trigger, or the
skill's input contract is amended to say honestly which categories are transcript-only and
usually missing. Either way, the next review run (a) knows before it starts whether session
evidence will exist, and (b) stops carrying a five-category contract that silently degrades to
one category every time.

## Non-goals

- No engine change, no new CLI flags, no new artifact types in stage schemas.
- No automatic session recording or transcript discovery — the skill's prohibition on discovering
  transcript stores stands.
- No retroactive synthesis of notes for past cycles.
- No change to the event grammar of `mine_transcript.ts` (the stem bug is tracked separately in
  `mine-transcript-delegation-stem`).

## Design space & open questions

- **(a) Standing supply practice** (recommended): the maintainer exports session transcripts for
  each dogfooding cycle to a path of their choosing and passes the paths at review invocation;
  the skill's Step 1 preamble gains one sentence: "if no notes and no transcripts exist for a
  cycle, ask the maintainer for transcript paths before marking categories none-observed." The
  review prompt becomes active instead of silently degrading.
- **(b) Honest-contract amendment**: amend SKILL.md §3 to state that categories 1, 2, 4, 5 are
  transcript-derived and expected to be `none-observed` unless transcripts are supplied, and
  retire baseline row M-12's "pending" framing accordingly. Cheaper, but concedes the economics
  lens.
- **(c) Per-cycle note convention** (a small notes file per change folder): rejected for now —
  new surface the authoring stages would need to carry or remind about; revisit only if (a)
  fails twice.
- Open question: where do supplied transcripts live? Anywhere the maintainer chooses (the miner
  takes explicit paths; nothing is discovered or hardcoded). A gitignored conventional path (e.g.
  under `/tmp` or a maintainer-chosen dir) is a maintainer decision, not toolkit surface.

## Requirement seeds

- FR-001: The improvement-review skill's Step 1 instructs the reviewing agent to request
  transcript paths from the maintainer when a cycle has neither notes nor transcripts, before
  marking categories none-observed.
- FR-002: The skill's inputs section names the supply practice (maintainer-exported transcripts,
  explicit paths at invocation) so the expectation is written where every run reads it.
- FR-003: Baseline row M-12 is updated by this change's knowledge extraction to reflect the
  practice (first successful mining run replaces the pending value, per the row's own recipe).
- NFR-001: Zero changes under `src/scripts/`, `bin/`, `src/stages/`; the miner's no-discovery
  rule is preserved verbatim.

## Implementation sketch

1. Requirements/design: choose (a) vs (b) — the kickoff request proposes (a) with (b) as the
   recorded fallback if the maintainer judges supply unsustainable.
2. Implementation: edit `src/skills/improvement-review/SKILL.md` §1/§3 (one to three sentences);
   knowledge-extraction delta updates M-12's comparability note.
3. Verification: next review run (2026-08-28 + N cycles) either mines at least one supplied
   transcript or records the maintainer's explicit (b) election in its proposals' Origin fields.

## References

- `src/skills/improvement-review/SKILL.md` — §1 preconditions (thin-signal), §3 instrumentation
  five categories, §5 transcript mining and designed degradation (read-verified 2026-08-28)
- `docs/current/operations.md` — `## Baselines` row M-12 (pending since 2026-08-27)
- `docs/changes/rehome-improvement-review-canon/feedback.yaml` — FB-001 (the one reconstructed
  category-3 instance)
- `docs/ideas/review-round-findings.md` — adjacent durability proposal (rounds must carry
  findings so rationale survives without transcripts)
- `docs/ideas/mine-transcript-delegation-stem.md` — miner correctness prerequisite
- `docs/current/capabilities.md` — `## SDLC Goals` G-01 (continuity from artifacts), G-08
  (scripts-first: measurement is script work; supply is the human half)

## Governance-test-result

- No judgment placed inside the engine: compliant — the change is skill-doc prose plus a baseline
  note; the requesting-for-transcripts behavior lives in the reviewing agent, not the CLI.
- Capped check catalog untouched: no design-review governance event.
- Frozen CLI envelope untouched: no decision governance event.
- Canon mutation path: M-12 row updated only through this landing change's knowledge extraction —
  compliant.

## Kickoff (new session)

```sh
sdlc requirements --change session-evidence-supply --request "Close the session-evidence supply gap in the improvement-review method: two consecutive runs had zero instrumentation notes and zero supplied transcripts (baseline M-12 pending since 2026-08-27), so amend the skill's Step 1 to request transcript paths from the maintainer before marking instrumentation categories none-observed, name the supply practice in the skill inputs, and update baseline row M-12 via knowledge extraction."
```
