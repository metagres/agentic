# All-Pass Semantic Walks Force Per-Check Evidence Authoring

| Field | Value |
|---|---|
| Origin | Improvement-review run of 2026-09-07 (maintainer-invoked), finding E-2; cycle in scope: `agents-working-sdlc-stages-are-too-verbose-in-chat-replies` (instrumentation notes absent — reconstructed-or-missing; reconstructed from 14 maintainer-supplied session transcripts); thin-signal check passed (6 changes with dated activity after 2026-08-28, no maintainer confirmation required) |
| Status | Proposed |
| Suggested change slug | `semantic-walk-compact-pass` |
| Depends on | `review-round-findings` (landed — the open/complete round lifecycle this proposal builds on) |
| Kind | Engine change (review kind interpreter + findings-file validation + error catalog) |
| Cost tier | Structural — the acceptance contract of every review stage changes; a text-only guidance fix was rejected because the mandate is mechanical (the CLI refuses acceptance without per-check evidence), so only an engine rule change can remove the work |

## Problem

The change in scope (`agents-working-sdlc-stages-are-too-verbose-in-chat-replies`) removed
passed-check enumeration from reviewer *chat* (DM-003, failures-only reporting), but the engine
still forces the reviewer to author the artifact-side equivalent: acceptance requires a
`--findings` semantic section with one `{check_id, status, evidence}` item per declared check —
evidence required, all pass — and records it verbatim into the round file. For a clean artifact
the reviewer writes prose evidence for every single check. That is the same verbosity the change
targets, relocated from chat into a mandatory artifact, and it is paid on every accept of every
review stage.

## Evidence

All observations dated 2026-09-07.

- Engine mandate: `src/scripts/lib/kinds/review.ts` acceptance instructions require "one
  {check_id, status, evidence} item per check above, all status 'pass'" (line ~520);
  `SemanticWalkResult` in `src/scripts/lib/review-findings.ts` declares `evidence: string` as a
  required field (lines 53–57); the round records `semantic.results` verbatim
  (`kinds/review.ts` line ~618).
- Artifact volume: this change's four zero-findings rounds carry 36 pass entries with evidence —
  `requirements-review.yaml` 94 lines (14 entries), `design-review.yaml` 82 (6),
  `plan-review.yaml` 72 (9), `implementation-review.yaml` 73 (7); the semantic blocks are the
  majority of each file. No baseline row exists for round-file volume or semantic-entry count —
  **initial-baseline candidate** for this landing change's knowledge extraction.
- Reviewer output cost: the six stage-reviewer sessions supplied for this change report
  4891–6370 output tokens each (`info.tokens.output`, session files under
  `docs/changes/agents-working-sdlc-stages-are-too-verbose-in-chat-replies/sessions/`, mined
  2026-09-07). A substantial share is semantic-walk evidence authoring — per-session attribution
  between chat and findings authoring is not extractable by the line-oriented miner and is
  **labeled an unverified hypothesis**: `missing_evidence` — a transcript diff of assistant
  messages against the `--findings` file content would attribute the share.
- The walk's *content* is honor-system (evidence text is self-assessed; only completeness and
  the all-pass status are mechanical) — gate classification per the review method §6:
  mechanical completeness + honor-system content.

**What worked** (fairness note, dated): the completeness check is enforceable and was enforced —
all four reviews of this change supplied complete walks on the first round (36/36 items, all
accepted, zero mechanical findings, one round per stage, zero re-open loops; mined
`wasted_round_candidates` = 0, 2026-09-07). The proposal keeps that enforceability; it only
questions what a *pass* entry must carry.

## Goal

A zero-findings acceptance records that every check passed — compactly. Reviewer authoring cost
per accepted round drops from one evidence paragraph per check to evidence only where the
reviewer has something to say (non-pass, advisory, or exceptional cases), while the walk remains
complete and mechanically validated.

## Non-goals

- No change to the review gate, verdict flags, append-only round history, or the seven-field
  envelope.
- No reduction in which checks must be walked — completeness stays all-checks-all-stages.
- No change to findings entries (`{target, finding, fix?}`) — findings keep full prose.
- No auto-generated evidence inside the engine (that would fabricate audit records — rejected
  outright; whatever is recorded must come from the reviewer).

## Design space & open questions

- **(a) Evidence optional for pass entries** (recommended): pass items carry `check_id` +
  `status: pass`; `evidence` becomes required only for non-pass statuses and advisory notes.
  Round files shrink; the reviewer's judgment stays at the call site (a reviewer may still
  supply evidence on a pass — the field is optional, not forbidden).
- **(b) Compact summary row**: an all-pass walk may be supplied as one summary item
  (`{status: pass, checks: all}`) instead of per-check items. Cheapest to author, but loses
  per-check completeness as a recorded fact and weakens the mechanical completeness check.
- **(c) Status quo**: keep per-check evidence. Rejected here: it re-narrates the mechanical
  validation the engine just ran (the round's `mechanical` block already records validity),
  which is the exact anti-pattern DM-003 removed from chat.
- Open question (labeled unverified hypothesis, `missing_evidence` — the first post-deploy
  review round through the refreshed runtime): whether the retargeted failures-only reviewer
  prompt changes chat behavior in practice; this proposal's authoring-cost claim for *chat* is
  not yet observable, while the artifact-side mandate above is evidenced directly from the
  engine source and round files.

## Requirement seeds

- FR-001: When a semantic walk item carries `status: pass`, the `evidence` field is optional;
  for any other status, `evidence` is required and the existing
  `SEMANTIC_WALK_INVALID`/`FINDINGS_ENTRY_INVALID` refusal behavior is preserved.
- FR-002: Acceptance continues to require one item per declared check with all statuses pass —
  completeness validation is unchanged.
- FR-003: The round file records exactly what the reviewer supplied (pass items may omit
  evidence); no engine-generated evidence text appears anywhere.
- NFR-001: The findings-file error catalog entries are updated for the optionality rule; no new
  capped-catalog check is added (this is findings-file validation, not a stage structural
  check).

## Implementation sketch

1. `src/scripts/lib/review-findings.ts`: relax the pass-entry evidence requirement in
   `validateSemanticWalk`; keep non-pass evidence mandatory.
2. `src/scripts/lib/kinds/review.ts`: update the acceptance instructions text (the "one item per
   check" sentence) to state evidence is required only for non-pass items.
3. `src/policies/errors.yaml`: adjust the `SEMANTIC_WALK_INVALID` message wording if it names
   evidence as universally required.
4. Tests: extend the review-kind unit tests — all-pass walk without evidence accepted; non-pass
   without evidence refused; completeness still enforced.
5. Verify: `npm run validate`; one real review round through the deployed CLI recording a
   compact all-pass walk.

## References

- `src/scripts/lib/kinds/review.ts` — acceptance instructions and round recording (read-verified 2026-09-07)
- `src/scripts/lib/review-findings.ts` — `SemanticWalkResult` (evidence required), `validateSemanticWalk` (read-verified 2026-09-07)
- `docs/changes/agents-working-sdlc-stages-are-too-verbose-in-chat-replies/requirements-review.yaml` (and the other three round files) — the 36-entry all-pass record this run measured
- `docs/changes/agents-working-sdlc-stages-are-too-verbose-in-chat-replies/design.yaml` — DM-003 and DEC-005 (the chat-side failures-only retarget this proposal extends to the artifact side)
- `docs/ideas/review-round-findings.md` — the landed round-lifecycle proposal whose round shape this proposal preserves
- `docs/current/capabilities.md` — `## SDLC Goals` G-02 (no field no consumer reads), G-03 (deterministic validation), G-08 (scripts-first economy)

## Governance-test-result

- No judgment placed inside the engine: compliant — optionality of a field is a mechanical rule;
  the reviewer's judgment about *what* evidence to supply stays at the call site, and no
  evidence is ever engine-generated.
- Capped check catalog untouched: no design-review governance event.
- Frozen CLI envelope: the `--findings` input contract changes (evidence optional on pass
  entries) — **decision governance event flagged**; the seven-field envelope itself is
  untouched.
- Append-only review history: compliant — rounds keep their shape; only per-entry evidence
  optionality changes.

## Kickoff (new session)

```sh
sdlc requirements --change semantic-walk-compact-pass --request "Make semantic-walk evidence optional for pass entries: acceptance currently forces reviewers to author one {check_id, status, evidence} item per check with evidence required even when every check passes (36 all-pass evidence entries recorded across the four zero-findings rounds of agents-working-sdlc-stages-are-too-verbose-in-chat-replies), so relax evidence to required-only-for-non-pass while keeping the all-checks-all-pass completeness requirement, the verdict flags, and the append-only round history unchanged."
```
