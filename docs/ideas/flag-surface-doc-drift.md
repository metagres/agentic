# Authoring Flag Surface: AGENTS.md Enumeration Drift

| Field | Value |
|---|---|
| Origin | Improvement-review run of 2026-08-28 (maintainer-invoked), finding E-2 (unused-surface inventory, §7 of the review method) |
| Status | Proposed |
| Suggested change slug | `flag-surface-doc-drift` |
| Depends on | Nothing; adjudicates the removal half of the same inventory in `introspection-flags-consumer-test` |
| Kind | Documentation accuracy (AGENTS.md + codemap; zero engine change) |
| Cost tier | Quick win |

## Problem

AGENTS.md §4 documents the authoring flag loop as exactly eleven flags: `--change`, `--request`,
`--next-ids`, `--update-artifact`, `--append-delta`, `--complete-step`, `--finalize`,
`--confirm-semantic`, `--describe`, `--describe-step`, `--help`. The engine's authoring
interpreter actually accepts seventeen. Six real flags are absent from the contract document that
agents and maintainers read first: `--record-answer`, `--record-answers`, `--set-clarity`,
`--bump-version`, `--help-step`, `--keep-status` (plus the `--lens/--question/--answer` parameter
triple of `--record-answer`).

An agent authoring requirements is *instructed by stage steps.yaml* to use three of the
undocumented flags (`--record-answer`, `--set-clarity` at
`src/stages/requirements/steps.yaml:40-41,59,65-66`; `--bump-version` at line 83) — the document
that claims to enumerate the flag loop does not.

## Evidence

Grep inventory, 2026-08-28:

- Engine flag surface — `rtk grep -on "args\['[a-z-]*'\]" src/scripts/lib/kinds/authoring.ts`
  yields: `keep-status` (:213), `record-answers` (:307), `bump-version` (:484),
  `describe-step` (:630), `next-ids` (:763), `update-artifact` (:784), `record-answer` (:790),
  `set-clarity` (:807), `append-delta` (:817), `complete-step` (:823), `confirm-semantic` (:885),
  `help-step` (:1013) — plus `--change`, `--request`, `--finalize`, `--describe`, `--help`
  handled via parseArgs fields.
- AGENTS.md — `rtk grep -n "record-answer\|set-clarity\|bump-version\|help-step\|keep-status" AGENTS.md`
  yields zero matches.
- Live instruction consumers for three of the six: `rtk grep -n "record-answer\|set-clarity\|bump-version" src/stages/requirements/steps.yaml`
  yields matches at lines 40, 41, 59, 65, 66, 83.

## Goal

The authoring flag enumeration in AGENTS.md §4 is complete and stays complete. Either it lists
all seventeen flags, or — recommended — it stops being a manual enumeration and names the single
source of truth (`sdlc <stage> --help`, whose payload is engine-generated at
`src/scripts/lib/kinds/authoring.ts` `helpPayload()`), so the document cannot drift again.

## Non-goals

- No flag removal here — removal candidates are adjudicated separately in
  `introspection-flags-consumer-test` with their own consumer evidence.
- No engine change: `helpPayload()` already lists the full usage surface.
- No change to the frozen CLI envelope (flags are argv, not envelope fields).

## Design space & open questions

- **(a) Replace the enumeration with a pointer to `--help`** (recommended): one sentence — "the
  authoring flag loop is engine-generated; run `sdlc <stage> --help` for the authoritative list" —
  plus keeping the six-step tour description. Drift-proof by construction.
- **(b) Complete the enumeration** (list all seventeen): fixes today's drift, reintroduces it on
  the next flag.
- Open question: should `helpPayload()` usage lines gain the stage-hook flags
  (`--record-answer`, `--set-clarity`) that only some stages support? Today they appear only in
  requirements steps.yaml; the help payload is generic. Out of scope here; note for the landing
  design.

## Requirement seeds

- FR-001: AGENTS.md §4 no longer enumerates the authoring flags manually; it names
  `sdlc <stage> --help` as the authoritative, engine-generated flag list.
- FR-002: The codemap rows that mention individual flags (`src/scripts/lib/kinds/codemap.md:39`
  mentions `--keep-status`) stay consistent with the new wording.
- NFR-001: Zero changes under `src/scripts/`, `bin/`, `src/stages/`.

## Implementation sketch

1. Edit AGENTS.md §4 authoring-kind paragraph: replace the eleven-flag parenthetical with the
   pointer to `--help` (keep the six-step tour and finalize semantics text).
2. Sweep `codemap.md` and `src/scripts/lib/kinds/codemap.md` for flag enumerations that claim
   completeness; align wording.
3. Docs-only change: `npm run validate` not required per AGENTS.md §1, but run it anyway as the
   change touches nothing else — cheap confidence.

## References

- `AGENTS.md` — §4 "The four kinds (DEC-006)", authoring flag-loop sentence (read-verified 2026-08-28)
- `src/scripts/lib/kinds/authoring.ts` — `helpPayload()` usage list (:578-611), flag dispatch (:763-827)
- `src/stages/requirements/steps.yaml` — instruction consumers at :40-41, :59, :65-66, :83
- `src/scripts/lib/kinds/codemap.md:39` — codemap flag mention
- `docs/current/capabilities.md` — `## SDLC Goals` G-05 (consumer test), G-08 (scripts-first)

## Governance-test-result

- No judgment placed inside the engine: compliant (documentation-only).
- Capped check catalog untouched: no design-review governance event.
- Frozen CLI envelope untouched: no decision governance event.
- AGENTS.md itself is edited by the landing change — allowed (AGENTS.md §9 duty: docs updated
  when behavior/documentation drifts); the edit is documentation, not an invariant change.

## Kickoff (new session)

```sh
sdlc requirements --change flag-surface-doc-drift --request "Fix the authoring flag-surface documentation drift: AGENTS.md section 4 enumerates eleven authoring flags but the engine accepts seventeen (record-answer, record-answers, set-clarity, bump-version, help-step, keep-status are undocumented); replace the manual enumeration with a pointer to the engine-generated sdlc <stage> --help payload as the single source of truth and align codemap wording."
```
