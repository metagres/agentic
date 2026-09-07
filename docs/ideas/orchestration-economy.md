# Orchestrators Re-Delegate and Pre-Discover What State Calls and Subagents Already Cover

| Field | Value |
|---|---|
| Origin | Improvement-review run of 2026-09-07 (maintainer-invoked), findings E-8, E-9, E-10 — maintainer-supplied session observations (2026-09-07) converted per the adjudication rule, grounded in the 14 supplied transcripts of `agents-working-sdlc-stages-are-too-verbose-in-chat-replies`; thin-signal check passed (6 changes with dated activity after 2026-08-28, no maintainer confirmation required) |
| Status | Proposed |
| Suggested change slug | `orchestration-economy` |
| Depends on | Nothing hard; complements `agents-working-sdlc-stages-are-too-verbose-in-chat-replies` (landed — the same output-discipline lever, aimed at the orchestrator instead of the stage agent) |
| Kind | Engine text + additive field change (deployed skill body loop step in `bin/deploy-to-agent.ts`, directive wording in `src/scripts/lib/delegation.ts`, round counter in `src/scripts/lib/kinds/review.ts`; no envelope shape change) |
| Cost tier | Quick win |

## Problem

Multi-agent stage work pays an orchestration tax the stage agents themselves do not pay. The
maintainer's expected process flow (2026-09-07) is a status-driven loop: (1) the main agent checks
change status, which reports which stage must happen; (2) it delegates the stage to the bound
stage agent unless the stage is its own to run; (3) the subagent runs the stage and reports
success or failure — that report should be enough; (4) the main agent re-runs status, verifies
the stage completed, and continues per instruction to the next stage. Three observed patterns
diverge from that loop, all visible only in session transcripts:

1. **Failed invocations from wrong context**: CLI calls fail because they run where the CLI
   cannot resolve what they need, and the agent retries after reading the error. The adapted
   miner now counts these mechanically.
2. **Pre-delegation discovery**: the orchestrator performs discovery work (reads, CLI calls)
   before delegating that the delegated agent could have performed itself — the delegated agent
   can invoke the CLI and read the envelope, and demonstrably does.
3. **Redundant re-delegation made invisible by the round lifecycle**: the orchestrator asks the
   stage-reviewer to perform a review step the previous step already completed, instead of
   checking stage state first — and when this happens, the review artifact cannot show it. A bare
   invocation on an open round *refreshes it in place* with the same round number
   (`src/scripts/lib/kinds/review.ts`, the open/refresh/verdict lifecycle), so one round is
   recorded no matter how many times the reviewer was invoked for the same artifact. More reviewer
   calls than rounds is a mechanical defect signal — but it exists only in transcripts; the
   durable record erases it, and an agent resuming from artifacts alone (goal G-01) cannot see
   the review was paid for twice.

Each is a zero-change round-trip paid in the orchestrator's tokens — the currency goal G-08
names. The engine already supports every step of the expected loop — `sdlc status` reports
`current_workflow`, `suggested_command`, and per-stage bound `agent` ids explicitly so the
primary agent can decide delegation (status.ts, DEC-004), and the landed output-discipline
fragment mandates the subagent's one-line completion report. The gap is the instruction surface:
the deployed skill body instructs steps 1–2 and delegation (run status; follow the instructions
field; the CLI owns stage detection; a bound stage is run via that agent) but never closes the
loop — no instruction says to re-run status after a delegated stage reports completion, verify
the stage advanced, and continue to the next suggested stage. The orchestrator was never told
the loop, so the observed freelancing violates nothing it was ever told.

## Evidence

All observations dated 2026-09-07; commands and sources recorded beside every number.

- **Failure events (class 1, mechanically counted)**: the adapted miner
  (`node src/skills/improvement-review/scripts/mine_transcript.ts <sessions>`, 2026-09-07)
  reports 2 failure events in the supplied sessions — `USAGE` ×2 in
  `sessions/requirements-review-round-stage-reviewer-subagent.json`: the reviewer twice passed
  the findings YAML content inline where the CLI expected a file path
  (`--findings file not found: {"semantic": [...`), was rejected with the named code and fix,
  and retried. Wrong-location failures (`CHANGE_DIR_NOT_FOUND`, `MISSING_CHANGE_DIR`) count 0 in
  these 14 files; the maintainer's wrong-location observations come from other dogfooding cycles
  and will be counted by future runs.
- **Subagent self-service (class 2, context)**: the delegated agents demonstrably invoke the CLI
  themselves — the implementation-engineer session records 14 sdlc invocations, each review
  session 5–10 (miner invocation map, 2026-09-07). The capability the orchestrator pre-empting
  exists and is used.
- **Redundant re-delegation (class 3, maintainer observation + engine reading)**: the maintainer
  reports (2026-09-07, direct session reading) that the stage-reviewer was repeatedly asked by
  the main agent to perform a step the previous step had already completed. The invisibility is
  verified in the engine: a bare invocation on an open round replaces it in place keeping the
  round number (`src/scripts/lib/kinds/review.ts`, open/refresh path), so the round count cannot
  exceed one per lifecycle regardless of invocation count. In this change's supplied sessions the
  divergence did not occur — 4 distinct stage-reviewer sessions map 1:1 onto 4 single-round review
  files (session-id dedup of the 14 exports, 2026-09-07) — so the signal is recorded here as a
  maintainer observation from other cycles: `missing_evidence` — main-agent session exports would
  confirm the re-ask count; the round-refresh counter seeded below would make future instances
  visible in the artifact itself.
- **What worked** (fairness note, dated): the CLI's failure envelopes already carry named codes
  with fix text (the `USAGE` rejection named the exact problem), and the subagents already
  self-serve state through the CLI — the proposal only redirects the orchestrator to the same
  two mechanisms, it does not create anything new.

## Goal

The status-driven orchestration loop becomes the written contract, and any residual redundancy is
visible in the durable record. Proposed canon entry (stated in canon format per the goals gate):

> | ID | Goal | Grounding | Status | Created | Amendments |
> |----|------|-----------|--------|---------|------------|
> | G-09 | Given a change in progress, the orchestrator runs one status-driven loop: check `sdlc status`, delegate the suggested stage to its bound agent (unless the stage is the orchestrator's own to run), accept the subagent's one-line completion report, re-check status to verify the stage advanced, and continue per instruction to the next suggested stage — never re-delegating a stage whose status is accepted and never performing a delegated stage's discovery itself. | status.ts DEC-004 (per-stage agent field for delegation decisions); the deployed skill body's delegation rule; the landed output-discipline fragment (one-line completion reports); session evidence of re-delegation and pre-delegation discovery (2026-09-07). | proposed | 2026-09-07 | none |

One delegation directive sentence makes `sdlc status` the pre-re-delegation reflex; a per-round
invocation counter makes more-reviewer-calls-than-rounds readable from the review artifact
itself; the skill body gains the loop-closure instruction.

## Non-goals

- No envelope shape change — the seven frozen fields stay; only the composed directive text
  gains a sentence and the review file gains an additive counter field.
- No mechanical blocking of re-delegation (the CLI cannot judge whether a re-ask is redundant —
  that is orchestration judgment and stays at the call site).
- No new flags or stage changes.
- No change to the review round lifecycle semantics (open/refresh/verdict stays; re-asks that
  refresh an open round remain legal — the proposal makes them *counted and visible*, not
  forbidden).

## Design space & open questions

- **(a) Loop closure in the skill body + directive sentence** (recommended): the deployed skill
  body (`SKILL_TEMPLATE` in `bin/deploy-to-agent.ts`) gains the loop-back step — when a delegated
  (or self-run) stage reports completion, re-run `sdlc status`, verify the stage advanced, and
  follow the instructions for the next suggested stage; never re-delegate a stage whose status is
  accepted; pass the change slug and let the delegated agent run its own discovery. The
  delegation directive composed by `src/scripts/lib/delegation.ts` gains the same state-check
  clause so the rule rides every bound-stage envelope, not only the skill preamble.
- **(b) Reviewer-side completion echo**: the review envelope's instructions already state the
  verdict outcome; strengthen the reviewer's closing line to name the completed round explicitly
  so the orchestrator's next step can see completion without a status call. Cheaper per
  instance, but relies on the orchestrator reading the transcript rather than the CLI state.
- **(c) Round refresh counter** (recommended as the artifact-side complement): the review round
  records how many times the review CLI was invoked for it — a bare invocation on an open round
  increments a `refreshes` counter carried into the closed round on verdict. `refreshes: 0` is
  the designed tour (open → verdict); `refreshes > 0` with an unchanged `artifact_version` is a
  zero-change round-trip visible in the artifact, no transcript needed. Additive optional field —
  legacy rounds without it are unaffected (the same backward-compatibility rule
  review-round-findings established for the status field).
- **(d) Method-only**: record the three classes in the improvement-review method (done this run)
  and change nothing in the engine. Cheapest, but the tax keeps being paid every cycle and stays
  invisible in artifacts.
- Recommendation: (a) + (c) — the directive sentence changes orchestrator behavior, the refresh
  counter makes any residual redundancy measurable in the durable record; (b) evaluated during
  design as a complement.
- Open question: does the state-check reflex add a status call on every delegation (its own
  cost)? The directive should scope it to before *re*-delegation and after ambiguity, not before
  every first delegation — the kickoff should word the trigger precisely.
- Open question: should a refresh with `refreshes > 1` also ride the envelope `warnings` array at
  call time, so the orchestrator sees the redundancy immediately? Leans on the warnings field
  (shape unchanged); decide during design.

## Requirement seeds

- FR-001: The delegation directive instructs the orchestrator to verify stage state via
  `sdlc status --change <slug>` before re-delegating a stage, and never to re-delegate a stage
  whose tracked artifact is already accepted.
- FR-002: The delegation directive instructs the orchestrator to pass the change slug and stage
  context without performing the delegated stage's discovery itself — the delegated agent
  resolves its own state through the CLI.
- FR-003: The composed directive remains deterministic text composed from the declarative
  binding at the single funnel; cross-cutting commands (status, feedback, doctor) still emit no
  directive.
- FR-004: Each review round records the number of times the review CLI was invoked for it: a
  bare invocation on an open round increments the count in place; the verdict carries the count
  into the closed round. The field is optional and additive — rounds recorded before this change
  are read as count-1 and never rewritten.
- FR-005: The deployed skill body instructs the loop closure: after a delegated or self-run stage
  reports completion, re-run `sdlc status`, verify the stage advanced, and follow the
  instructions for the next suggested stage; never re-delegate a stage whose status is accepted;
  delegate with the change slug and let the delegated agent perform its own discovery.
- NFR-001: The directive stays within the envelope's `instructions` field and the loop
  instruction within the generated skill body; the seven frozen top-level fields, all flag
  surfaces, and the deploy-smoke marker contract are unchanged.

## Implementation sketch

1. `bin/deploy-to-agent.ts` (`SKILL_TEMPLATE`): add the loop-closure step after the delegation
   step — re-run status on completion, verify the stage advanced, continue per instructions,
   never re-delegate an accepted stage, let the delegated agent discover. The
   `DELEGATION_RULE_MARKER` smoke contract is untouched (the rule text stays verbatim).
2. `src/scripts/lib/delegation.ts`: extend the directive text (both the authoring and review
   variants) with the state-check and no-pre-discovery sentences; keep composition pure and
   deterministic.
3. `src/scripts/lib/kinds/review.ts`: on a bare invocation with an open round, increment the
   round's invocation count in place; on verdict, carry the count into the closed round; fresh
   rounds start at 1. Legacy rounds without the field read as 1 and are never rewritten
   (append-only invariant preserved — the counter rides the same in-place refresh the lifecycle
   already sanctions).
4. Tests: skill-body rendering asserts the loop-closure step; delegation tests extend the
   expected directive text; review-kind tests assert the counter increments across bare
   invocations and carries into the verdict; cross-cutting envelopes stay byte-identical.
5. Verify: `npm run validate`, `npm run deploy:smoke`, then a real deploy per invariant 12; one
   real delegation and one re-invocation through the deployed CLI showing the loop instruction,
   the directive sentences, and the counter.
6. Knowledge-extraction delta: conventions entry for the orchestrator loop, the state-check
   reflex, and the round invocation-count field; the G-09 canon entry lands through this
   change's knowledge extraction.

## References

- `bin/deploy-to-agent.ts` — `SKILL_TEMPLATE` (the deployed skill body: steps 1–4 instructed, loop-back absent) and the `DELEGATION_RULE_MARKER` smoke contract (read-verified 2026-09-07)
- `src/scripts/workflows/status.ts` — `current_workflow`, `suggested_command`, per-stage `agent` field (DEC-004) — the state surface the loop runs on (read-verified 2026-09-07)
- `src/scripts/lib/kinds/review.ts` — the open/refresh/verdict round lifecycle whose in-place refresh erases invocation counts (read-verified 2026-09-07)
- `src/scripts/lib/delegation.ts` — the directive composition this proposal extends (cited in `docs/current/capabilities.md`, read-verified 2026-09-07)
- `docs/changes/agents-working-sdlc-stages-are-too-verbose-in-chat-replies/sessions/` — the 14 supplied transcripts (2 `USAGE` failures; per-session invocation maps, mined 2026-09-07)
- `src/skills/improvement-review/scripts/mine_transcript.ts` — the failure-event grammar that makes class 1 measurable (adapted 2026-09-07)
- `docs/current/capabilities.md` — `## SDLC Goals` G-02 (bounded rounds, no zero-change round-trips), G-08 (the agent's time is the currency)
- `docs/current/operations.md` — `## Commands` (the `sdlc status` state surface the reflex uses)

## Governance-test-result

- No judgment placed inside the engine: compliant — the directive is static deterministic text
  and the counter is a mechanical increment; the state-check and the redundancy judgment are
  performed by the orchestrating agent, never by the CLI.
- Review history append-only invariant: compliant — the counter rides the in-place refresh the
  round lifecycle already sanctions for open rounds; closed rounds and legacy rounds are never
  rewritten.
- Capped check catalog untouched: no design-review governance event.
- Frozen CLI envelope: the directive lives inside the envelope's `instructions` field and the
  loop step inside the generated skill body — the seven-field shape is untouched, but the
  payload contract changes — **decision governance event flagged** conservatively.
- Deploy smoke: the `DELEGATION_RULE_MARKER` contract is untouched (the delegation rule text
  stays verbatim); the new loop step is additive body text.
- Agent-agnostic rule: compliant — the directive composes from the declarative binding; no
  agent-specific paths.

## Kickoff (new session)

```sh
sdlc requirements --change orchestration-economy --request "Make the status-driven orchestration loop the written contract (proposed goal G-09): the orchestrator checks sdlc status, delegates the suggested stage to its bound agent, accepts the subagent's one-line completion report, re-checks status to verify the stage advanced, and continues to the next suggested stage — session transcripts show the orchestrator instead re-delegating completed reviews, performing discovery the subagent repeats, and retrying CLI calls that failed from the wrong context (2 USAGE rejections in the requirements-review session), and the deployed skill body never instructs the loop-back. Add the loop-closure step to the skill body in bin/deploy-to-agent.ts, the state-check and no-pre-discovery sentences to the delegation directive in src/scripts/lib/delegation.ts, and an additive per-round invocation counter in src/scripts/lib/kinds/review.ts so more-reviewer-calls-than-rounds is visible in the review artifact; envelope shape, flags, round lifecycle semantics, and the deploy-smoke marker stay unchanged."
```
