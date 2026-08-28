# Introspection Flags Fail the Consumer Test

| Field | Value |
|---|---|
| Origin | Improvement-review run of 2026-08-28 (maintainer-invoked), finding E-3 (unused-surface inventory, §7 of the review method; gate classification §6) |
| Status | Proposed |
| Suggested change slug | `introspection-flags-consumer-test` |
| Depends on | Nothing hard; reads best after `flag-surface-doc-drift` (same inventory, doc half lands first) |
| Kind | Engine surface reduction (authoring kind interpreter; no envelope-shape change) |
| Cost tier | Structural — it changes the documented authoring flag-loop contract, not just a file |

## Problem

Four authoring flags have zero instruction-level consumers — no stage's `steps.yaml` ever tells
an agent to call them, and no artifact or living doc consumes their output:

- `--describe` — renders workflow-level step definitions.
- `--describe-step <step>` — renders one step's markdown/commands/exit_criteria.
- `--keep-status` — preserves artifact status across `--update-artifact`.
- `--help-step` — embeds the current step's guidance in the envelope.

Two of them are also redundant with each other: `--describe-step` and `--help-step` render the
same step definitions from the same loader (`loadStepDefinitions`) — one on demand, one inline in
the envelope. Two mechanisms, one job.

Per goal G-05 ("the review might someday" is not a consumer) and the standing unused-surface
inventory, these are removal candidates — or they need a named consumer. This proposal performs
that adjudication with the grep evidence on record.

## Evidence

Grep inventory, 2026-08-28, full consumer scope (source, deployed skills, docs, tests):

- Stage instructions — `rtk grep -rn "describe\|help-step\|keep-status" src/stages/*/steps.yaml src/stages/*/template.yaml`
  → zero matches for all four flags.
- Deployed stage instructions — `rtk grep -rn "describe\|help-step\|keep-status" .opencode/skills/agentic-sdlc/stages/`
  → zero matches.
- Deployed SKILL.md — `rtk grep -c` for each flag against `.opencode/skills/agentic-sdlc/SKILL.md`
  → zero matches for all (the SKILL.md delegates to envelope instructions and carries no flags).
- Engine self-reference only — `helpPayload()` usage list (`src/scripts/lib/kinds/authoring.ts:589-590`)
  lists `--describe`/`--describe-step`; `src/scripts/lib/kinds/codemap.md:39` mentions
  `--keep-status`. A help line listing a flag is not a consumer.
- Tests — one unit test covers `--help-step` behavior ("the authoring envelope omits step_help by
  default and restores it with --help-step"); `--describe`/`--describe-step`/`--keep-status` have
  no covering tests found (codegraph blast-radius check, 2026-08-28). Tests prove mechanism, not
  demand.
- **Labeled unverified hypothesis**: agents may call `--describe`/`--describe-step` ad-hoc in
  sessions. `missing_evidence`: session transcripts showing such calls — none have ever been
  supplied (see `session-evidence-supply`; baseline row M-12 still pending). This hypothesis does
  not enter the removal case as fact; it caps the confidence of any removal.

Contrast — flags the same inventory **refuted** as removal candidates (live instruction
consumers): `--next-ids` (requirements/design/planning steps.yaml), `--append-delta` (design/
planning), `--update-artifact` (design/planning), `--confirm-semantic` (design/planning),
`--record-answer`/`--set-clarity`/`--bump-version` (requirements), and `--complete-step`, whose
legacy metadata flags (`discovery_reviewed`, `assumptions_reviewed`, `scenarios_reviewed`,
`delta_reviewed`) are consumed by the requirements discovery gate
(`src/stages/requirements/hooks.ts:173-263`, `src/scripts/lib/stage-helpers.ts:11`).

## Goal

The authoring flag loop carries no flag without a named consumer. Concretely:

- One mechanism for step guidance: `--help-step` (inline, envelope-carried) survives;
  `--describe-step` is removed, or a named consumer is documented for it.
- `--describe` is removed, or a named consumer is documented.
- `--keep-status` is removed, or a named consumer is documented.
- Whichever way each flag lands, the decision is recorded with the consumer named or the removal
  executed, per G-05 ("removed or refuted").

## Non-goals

- No change to the frozen CLI envelope top-level shape (flags are argv surface).
- No change to `--help` / `--help-step` semantics beyond possible removal of siblings.
- No new flags introduced.
- No retroactive tooling for detecting flag usage in past sessions (transcripts were never kept).

## Design space & open questions

- **`--describe-step` vs `--help-step`** (recommended: keep `--help-step`, remove
  `--describe-step`): the inline form is the one the envelope economy was designed around
  (`docs/current/operations.md` baseline: "step_help only behind --help-step"); the on-demand
  form duplicates its renderer. Alternative: keep `--describe-step` as the on-demand form and
  drop `--help-step` — rejected here because inline guidance avoids a round-trip, which is the
  economy the reform optimized.
- **`--describe`**: workflow-level description overlaps `--help` (usage) and `status` (pipeline
  position). Removal candidate; the design step of the landing change confirms nothing in the
  deployed bundle's instruction flow references it.
- **`--keep-status`**: narrowest flag, zero consumers found anywhere including tests. Removal
  candidate; open question — was it added for a specific update flow that since changed? The
  landing change's requirements step should answer from git history before deleting.
- Open question: does removing flags require a deprecation cycle? The consumer scope is this
  repository plus deployed skills (rebuilt on every deploy) plus other repositories (unknown —
  the maintainer is the consumer of record for external use; the kickoff request should confirm).

## Requirement seeds

- FR-001: Each of `--describe`, `--describe-step`, `--keep-status` is either removed from the
  authoring interpreter, its help payload, and AGENTS.md-adjacent docs, or carries a named,
  dated consumer in the design artifact.
- FR-002: Step-guidance rendering exists through exactly one mechanism after the change.
- FR-003: The unit-test suite drops or rewrites coverage to match the surviving surface; no test
  asserts a removed flag.
- NFR-001: The envelope top-level shape is byte-identical before and after.

## Implementation sketch

1. Requirements step: resolve the `--keep-status` origin question from git history; confirm the
   external-repository consumer question with the maintainer.
2. Design step: pick keep/remove per flag; if removing, enumerate the touch points —
   `src/scripts/lib/kinds/authoring.ts` (dispatch + `describeWorkflow`/`describeStep`/`helpPayload`),
   `src/scripts/lib/kinds/codemap.md`, AGENTS.md §4 wording (post-`flag-surface-doc-drift` this is
   a pointer, so likely untouched), deployed bundle rebuild.
3. Implementation + tests: remove dispatch branches and renderer functions; update/kill the
   affected unit tests; `npm run validate` plus `npm run deploy:smoke` (deploy output changes).

## References

- `src/scripts/lib/kinds/authoring.ts` — dispatch (:625-634), `describeWorkflow` (:506),
  `describeStep` (:523), `helpPayload` (:578), `keep-status` branch (:213)
- `src/stages/*/steps.yaml` — zero instruction consumers (grep, 2026-08-28)
- `docs/current/operations.md` — `## Baselines` qualitative row "step_help only behind --help-step"
- `docs/current/capabilities.md` — `## SDLC Goals` G-05, G-02
- `docs/ideas/flag-surface-doc-drift.md` — the doc half of the same inventory

## Governance-test-result

- No judgment placed inside the engine: compliant — removal is mechanical; the keep/remove
  decision per flag is made by the maintainer in the landing change's design step, not by the CLI.
- Capped check catalog untouched: no design-review governance event.
- Frozen CLI envelope untouched (top-level seven fields unchanged): no decision governance event.
- The authoring flag loop is documented in AGENTS.md §4 — the landing change updates that wording
  if flags are removed (AGENTS.md §9 docs duty), but no AGENTS.md invariant changes.

## Kickoff (new session)

```sh
sdlc requirements --change introspection-flags-consumer-test --request "Adjudicate the four consumer-less authoring flags (--describe, --describe-step, --keep-status, and the --describe-step/--help-step redundancy) per the unused-surface goal: remove each from the authoring interpreter and help payload or name a live consumer, keeping exactly one step-guidance mechanism, with the envelope top-level shape byte-identical."
```
