# AC Parent Back-Reference Check

| Field | Value |
|---|---|
| Origin | Requirements-review of `rehome-improvement-review-canon` (2026-08-27), finding B5 |
| Status | Proposed |
| Suggested change slug | `ac-parent-backref-check` |
| Depends on | Nothing |
| Kind | Capped-catalog extension (design-review event per AGENTS.md §2.11) |

## Problem

The structural layer enforces `ref-exists` (every AC's `parent_id` resolves to some FR/NFR id) and
`referenced-by` (every AC is claimed by some requirement's `ac_ids`), but not strict
back-referencing. In the review above, AC-021 carried `parent_id: FR-002` while FR-008 claimed it
in `ac_ids`, and the AC's Then-clause described FR-008's deliverable verbatim. No mechanical check
fired; an LLM reviewer caught it in round 2. Judgment did a script's job — the exact split the
automation-maximization goal (scripts-first, judgment-to-agent) forbids; that goal enters the
canon as G-08 via `rehome-improvement-review-canon`.

## Goal

For every FR/NFR, every id listed in its `ac_ids` shall have `parent_id` equal to that
requirement's id. Bidirectional parentage integrity becomes fully mechanical and fails at write
time (finalize, review, and `bin/lint-artifact.ts` share one `validateArtifact` path, so all three
surfaces get it at once).

## Non-goals

- No schema changes; the check reads existing fields.
- No retroactive validation of completed changes (they are final).
- No new envelope surface.

## Design space & open questions

- **New named check** in `src/scripts/lib/checks/` (e.g. `ac-backref`), declared per-stage in
  `structural-checks.yaml` — the single extension path. Recommended.
- **Extend `referenced-by` with a strict mode** — fewer catalog entries, but overloads an existing
  check's contract.
- Open question: which stages declare it? Requirements is the proven case; design/planning carry
  analogous id-link arrays and may adopt it after evidence.

Per AGENTS.md §9: new check → unit test + `errors.yaml` code, and the addition is a design-review
event.

## Expected saving

Eliminates a whole review-round class: parentage bugs currently surface only when an LLM reviewer
happens to re-derive the traceability matrix (one rejected round in the originating change).
Write-time enforcement per goal G-04.

## Tradeoff / risk

Catalog growth is a governance event and must pass the consumer test: the check consumes fields
every authoring stage already carries. Risk of false positives is nil (pure equality test).

## Kickoff

```sh
sdlc requirements --change ac-parent-backref-check --request "Add a strict AC back-reference check to the capped catalog: for every FR/NFR, every id in ac_ids must have parent_id equal to that requirement's id, so parentage bugs fail mechanical validation at write time instead of being caught by LLM reviewers."
```
