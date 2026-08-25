# Design Specification: LLM-First Requirements Authoring Redesign

| Field | Value |
|---|---|
| Status | Draft — for design review |
| Date | 2026-08-24 |
| Scope | `src/stages/requirements/` (all files), `src/scripts/lib/kinds/authoring.ts` (completeStep), `src/policies/errors.yaml`, `bin/validate-templates.ts`, tests |
| Out of scope | Engine architecture, stage topology, other stages' artifact shapes, `docs/current/` |
| Intended path | This document seeds a change request through the SDLC flow (requirements → design → …). It is pre-flow analysis, not a flow artifact. |

---

## 1. Context and problem

The requirements authoring stage exists to resolve ambiguity before design begins: catch edge
cases, surface hidden assumptions, and pin observable behavior. Its current implementation has
four structural weaknesses:

1. **Dual source of truth for the discovery gate.** `requirements-policy.yaml` and a
   byte-identical fallback map in `hooks.ts` coexist; the fallback silently wins when the file
   is missing or corrupt. Half the policy file (`discovery.lenses`) is read by nothing.
2. **Count-based discovery exit.** The gate passes on N resolved questions across M lenses.
   The step instruction literally says "Do not stop until `data.discovery_gate.passed` is true" —
   a satisficing stop line for an instruction-following agent, not a convergence judgment.
3. **Examples are output, not instrument.** Acceptance criteria (Given-When-Then) are written
   during drafting as a product of understanding. The strongest known ambiguity detector —
   deriving concrete examples during elicitation — is unused.
4. **No ambiguity re-check at exit.** Nothing asks "would two implementers build the same
   thing from this artifact?" before the artifact moves to review.

A further framing decision governs this whole spec: **the primary readers and writers of every
SDLC artifact are LLMs / coding agents, not humans.** Artifact generation and usage must be
optimized for that consumer.

## 2. Goals and non-goals

**Goals**

- G1: Make the discovery policy the single, fail-loud source of truth for discovery thresholds.
- G2: Replace the count-based discovery exit with floor + explicit confirmation.
- G3: Introduce example-driven elicitation (a `scenarios` step) that mechanically loops
  unresolved examples back into discovery.
- G4: Add an interpretation-divergence check and EARS phrasing guidance to validation.
- G5: Close the reference-validity gaps in structural checks (both AC↔FR directions,
  scenario outcomes).
- G6: Every change above must serve, and be justified by, the LLM-first principles (§3).

**Non-goals**

- Executable specifications / BDD test automation (no test-runner integration; ACs stay prose).
- Prioritization frameworks (MoSCoW), glossary sections, or richer metadata taxonomies.
- Increasing question counts or spec volume generally (see rejected alternatives, §8).
- Any change to stage topology, the requires DAG, or the envelope shape.

## 3. Design principles: LLM-first artifacts

The primary consumer of every artifact — requirements, design, plan — is an LLM agent. Each
invocation of the CLI is stateless; the artifact plus the envelope is the *entire* context an
agent has. These principles are the evaluation criteria for every design decision below.

| # | Principle | Consequence |
|---|---|---|
| P1 | **Deterministic structure over prose.** LLMs parse stable schemas reliably; free prose invites drift and interpretation variance. | Strict schemas stay strict; remaining prose (FR descriptions) is syntax-restricted (EARS); enums constrain vocabularies. |
| P2 | **Mechanical gates over self-assessment.** LLMs exhibit agreeableness and satisficing biases; every self-reported judgment is a failure point. Empirical work finds only a weak link between ambiguity and LLMs spontaneously asking clarifying questions. | Prefer structural checks. Where self-certification is unavoidable, make it an explicit flag set by a distinct command (`--complete-step`), auditable by the review stage. |
| P3 | **The envelope is the prompt.** Step markdown in `steps.yaml` is the only instruction surface the agent reliably sees. | Instructions are imperative, self-contained, name exact commands, and state exit conditions as data fields. |
| P4 | **Artifacts are inter-invocation memory.** No conversation state survives between CLI calls. | All new state lives in artifact sections or metadata flags — never in implied context. |
| P5 | **Examples are the native representation.** Concrete instances minimize interpretation divergence for both authoring and consuming agents. | Scenarios step; Given-When-Then everywhere; divergence check phrased over concrete behavior. |
| P6 | **Token economy.** Downstream stages re-read artifacts wholesale. | No content duplication across sections; reference by ID, never by quotation; bounded sections. |
| P7 | **Traceability links are the consumption API.** Downstream stages navigate via IDs (FR→AC→CMP→TASK). | Reference validity is mechanically enforced in every direction a link exists. |
| P8 | **Append-only where possible.** Destructive edits lose history and invite conflicts. | `discovery_log` and `scenarios` append; nothing rewrites entries in place. |

## 4. Evidence base (summary)

- **Elicititation practice** (Sommerville & Sawyer; Alexander & Beus-Dukic; Christel & Kang):
  the lens taxonomy already mirrors the canonical discovery approaches; elicitation exits on
  convergence, not count; ambiguous areas are candidates for elaboration via scenarios.
- **Specification by Example / Example Mapping** (Adžić; Wynne): concrete examples derived
  during elicitation are the strongest ambiguity detector; open questions fall out of examples
  naturally.
- **EARS** (Mavin; used at Airbus, NASA, Rolls-Royce): restricting requirement syntax to five
  patterns mechanically eliminates vague-subject and compound-statement ambiguity classes.
- **Requirements quality characteristics** (IEEE 830 lineage): atomic, unambiguous, verifiable,
  singular — each maps to a check below.
- **LLM-specific empiricism**: LLMs ask clarification questions unreliably in the presence of
  ambiguity (arXiv:2507.10445); ambiguity detection via *candidate-implementation divergence*
  measurably improves downstream code generation (ClarifyGPT, arXiv:2310.10996, GPT-4 Pass@1
  70.96% → 80.80%). Downstream consumers here are also LLMs, which resolve ambiguity by
  *silently picking an interpretation* — unresolved ambiguity is strictly more expensive in an
  agentic pipeline than in a human one.
- **Counterweight** (Ralph et al., requirements fixation): over-specification degrades design
  quality. The goal is resolved ambiguity, not spec volume.

## 5. Current state and gap analysis

| Capability | Current state | Verdict |
|---|---|---|
| Lens taxonomy | 8 lenses in policy; matches literature | Keep, refine (−`design`, +`data`) |
| Policy loading | Silent fallback, dual source of truth | **Replace** (G1) |
| Discovery exit | Count/lens floor only | **Replace** (G2) |
| Examples | ACs written in drafting, as output | **Move earlier, as instrument** (G3) |
| FR→AC coverage | Schema `ac_ids` `minItems: 1` | Already enforced — keep |
| AC↔FR reference *validity* | Not checked in either direction | **Add** `ref-exists` both ways (G5) |
| FR phrasing quality | `forbidden-words` (negative filter) only | **Add** EARS advisory (G4) |
| Divergence re-check | Absent | **Add** semantic check (G4) |
| Problem-first statement | Semantic check exists | Keep |

## 6. Target design

### 6.1 Step flow

```
needs_input → init → discovery → scenarios → assumptions → drafting → validation → delta → ready
                             ↑          |
                             └── open scenario → --record-answer (loop-back)
```

`discovery` and `scenarios` are hooks-driven extra steps (DEC-016 pattern); `scenarios` is new.
Step ordering inside `extraStep()` becomes: discovery → scenarios → assumptions.

### 6.2 Discovery policy: single source of truth (Option B)

`requirements-policy.yaml` becomes the only source of thresholds. The fallback map in
`discoveryGate()` is deleted. Loading is fail-loud:

- File absent → error `STAGE_POLICY_MISSING`.
- Present but unparsable or shape-invalid → error `STAGE_POLICY_INVALID`, naming the offending
  field.
- `--record-answer` with a lens outside `discovery.lenses` → error `UNKNOWN_LENS`, listing
  valid lenses.

Because the policy loads on every requirements invocation (it feeds `extraStep` and
`getExtraData`), a broken policy blocks the whole stage — intentional blast radius.

Load-time shape validation (in hooks, runs every invocation): `version == 1`; `lenses`
non-empty, unique, lowercase; `clarity` has exactly `clear|partial|vague`; each level's
`required_lenses ⊆ lenses` and non-empty; `min_resolved_questions ≥ required_lenses.length`;
`anchor` a non-empty string.

**Note on invariant 11:** this is *config loading* validation, not artifact validation. The
policy file is not an artifact; artifact validation remains purely catalog-driven. Hooks never
participate in artifact validation (unchanged).

Refined policy (full text):

```yaml
version: 1

# Discovery policy for the requirements stage. Loaded fail-loud by hooks.ts —
# this file is the single source of truth for the discovery gate.

discovery:
  # Controlled vocabulary for --record-answer --lens. Answers tagged with a
  # lens outside this list are rejected (UNKNOWN_LENS).
  lenses:
    - stakeholder   # who wants it, who is affected, who decides
    - scope         # what is in, what is explicitly out
    - interface     # where it touches users and other systems
    - behavior      # what it does in the normal case
    - data          # what information is created, read, stored; who owns it
    - constraint    # non-negotiable bounds: performance, security, compliance, platform
    - failure       # error paths and edge cases; what happens when things go wrong
    - outcome       # how success is observed; feeds acceptance criteria

  clarity:
    clear:
      anchor: The request already names the behavior, the interfaces, and the constraints.
      required_lenses: [failure, constraint]
      min_resolved_questions: 3

    partial:
      anchor: The goal is unambiguous, but interfaces, data, or constraints are incomplete.
      required_lenses: [stakeholder, interface, data, failure, constraint]
      min_resolved_questions: 5

    vague:
      anchor: The goal itself is ambiguous or admits multiple interpretations.
      required_lenses: [stakeholder, scope, interface, behavior, data, failure, constraint, outcome]
      min_resolved_questions: 8
```

Rationale: `design` removed (never required by any level; invites premature solutioning —
solution shape belongs to the design stage); `data` added (most common pre-design ambiguity
after scope; feeds design's `data_models`); `outcome` required for vague (a vague request's
defining gap is undefined success; seeds `acceptance_criteria`); anchors ground the self-assessed
clarity choice (P2: make self-assessment visible and correctable). Thresholds stay 3/5/8 —
coverage grows, round-trip cost does not. Emergent property: each level's minimum equals its
required-lens count, and the sets nest monotonically.

Gate output (`data.discovery_gate`) gains: `valid_lenses`, `clarity_anchor`, `confirmed`
(the `discovery_reviewed` flag). Envelope shape unchanged (fields inside `data` only).

### 6.3 Discovery exit: floor + explicit confirmation

The threshold becomes a checkpoint, not a stop line. `extraStep()` returns `'discovery'` while
`!gate.passed || metadata.discovery_reviewed !== true`. The step instruction changes from
"Do not stop until passed is true" to a two-phase instruction:

- While `passed` is false: ask one question at a time, grounded in a concrete situation where
  possible; record via `--record-answer`.
- Once `passed` is true: re-read the request and the discovery log; if any ambiguity remains,
  keep asking; only when you can assert none remains, run
  `--complete-step --step discovery`.

This mirrors the existing `assumptions`/`delta` escape-hatch pattern and `--confirm-semantic`.
The count proves effort; the confirmation is an auditable assertion ("I know of no remaining
ambiguity") that the review stage can challenge (P2).

### 6.4 Scenarios step and artifact section (example mapping)

New top-level artifact section `scenarios`, populated between discovery and assumptions:

```yaml
scenarios:
  - id: SC-001
    statement: "Given no device exists, When the client submits a registration, Then the system returns 201 and a device identifier."
    category: happy        # happy | edge | negative | boundary
    status: resolved       # resolved | open
    outcome: ac            # ac | question | out_of_scope
    ac_id: AC-001          # set when outcome: ac (during drafting)
    question_id: DL-006    # set when outcome: question (loop-back)
```

**Step behavior** (hooks `extraStep`, inserted between discovery and assumptions):

- Returns `'scenarios'` while any scenario has `status: open`, or while the section is empty
  and `metadata.scenarios_reviewed !== true` (escape hatch, mirroring `assumptions`).
- Step instruction (P3): enumerate concrete examples — happy path first, then a structured
  edge-case sweep: empty/missing input; invalid/malformed input; duplicates/idempotency;
  concurrency; boundary values (zero, one, max, empty collection); dependency failure
  (network, downstream error); permission/auth failure. For each example: if the behavior is
  known, record it as a `resolved` scenario; if it exposes ambiguity, record it as `open`,
  ask the user, then either resolve it (and link the answer via `question_id`) or record the
  answer with `--record-answer` and mark the scenario `outcome: question`.
- During drafting, resolved scenarios with `outcome: ac` are promoted to acceptance criteria
  (statement adapted to Given-When-Then, `parent_id` linked, `ac_id` back-filled on the
  scenario). `failure_paths` is populated from `negative`/`edge` scenarios.

**Why a dedicated section instead of drafting ACs early** (P4, P6, P7): the artifact is the
inter-invocation memory; draft ACs would be schema-invalid mid-flow (`parent_id` required) and
would conflate "example under elicitation" with "accepted criterion". A dedicated section makes
the example→outcome mapping itself mechanically checkable: every scenario must end as an AC, a
discovery question, or explicitly out of scope — no example silently vanishes.

**Mechanical enforcement** (all via existing catalog checks, params only — no new check types):

```yaml
- check: unique-ids
  params:
    arrays: [functional_requirements, non_functional_requirements, acceptance_criteria, discovery_log, scenarios]
- check: given-when-then
  params: {array: scenarios, statement_field: statement}
- check: ref-exists
  params:
    from: {array: scenarios, field: ac_id}
    to: {arrays: [acceptance_criteria], field: id}
- check: ref-exists
  params:
    from: {array: scenarios, field: question_id}
    to: {arrays: [discovery_log], field: id}
```

`ref-exists` accepts string refs and skips absent fields, so optional `ac_id`/`question_id`
work without conditional logic.

### 6.5 Drafting: EARS phrasing

Step markdown gains advisory phrasing guidance: FR descriptions should follow an EARS pattern —
`When <trigger>, the <system> shall <response>` / `While <precondition>, …` /
`Where <feature>, …` / `If <trigger>, then …` / `The <system> shall <response>`. Restricted
syntax removes whole ambiguity classes before any check runs (P1). Enforcement starts
advisory (semantic check); a structural EARS-pattern check would be a future catalog addition
and therefore a design-review event (see open questions).

### 6.6 Validation additions

**Structural** (in `structural-checks.yaml`, all existing catalog checks):

```yaml
- check: ref-exists
  params:
    from: {array: functional_requirements, field: ac_ids}
    to: {arrays: [acceptance_criteria], field: id}
- check: ref-exists
  params:
    from: {array: non_functional_requirements, field: ac_ids}
    to: {arrays: [acceptance_criteria], field: id}
- check: ref-exists
  params:
    from: {array: acceptance_criteria, field: parent_id}
    to: {arrays: [functional_requirements, non_functional_requirements], field: id}
```

These close the reference-validity gap in both directions (P7). Note: the reversed
`referenced-by` idea from earlier analysis is **not** usable — that check requires
array-typed ref fields (`parent_id` is a string) — and FR→AC *coverage* is already enforced by
the schema's `ac_ids: minItems 1`. Plus the scenario checks from §6.4.

**Semantic advisories** (in `semantic-checks.yaml`, appended):

1. *Interpretation divergence* (ClarifyGPT technique, prompt form): "For each FR, consider two
   independent implementations built from its text alone. If they could differ in any
   observable behavior, refine the FR or add an AC that pins the difference."
2. *EARS conformance*: "Is each FR description phrased in an EARS pattern
   (When/While/Where/If-then/The-system-shall)?"
3. *Atomicity*: "Does any FR join two behaviors with 'and'? If so, split it into two FRs."
4. *Scenario coverage*: "Does every resolved scenario with outcome `ac` have its AC present,
   and do the ACs collectively cover every happy-path and edge scenario recorded?"

Existing checks (problem-first, observable Then-clauses, negative-path coverage, etc.) are
retained unchanged.

**Dual enforcement, no review-stage changes.** The review kind loads the *tracked* stage's
semantic checklist (`semanticChecksFor(trackedStage)`, review.ts:230) and runs the same
`validateArtifact` (unified validation, FR-006). Every advisory above is therefore presented
twice from one declaration: to the authoring agent at `--finalize`, and to the reviewer agent
at requirements-review before `--accept`. Review stages carry no `semantic-checks.yaml` of
their own (CMP-009) and none is added.

### 6.7 Schema and template changes

`schema.yaml`:

- New top-level `scenarios` array: `id` (`^SC-[0-9]{3}$`), `statement`, `category`
  (`happy|edge|negative|boundary`), `status` (`resolved|open`), `outcome`
  (`ac|question|out_of_scope`), optional `ac_id` (`^AC-[0-9]{3}$`), optional `question_id`
  (`^DL-[0-9]{3}$`), `additionalProperties: true`.
- `metadata.properties` += `discovery_reviewed` (boolean), `scenarios_reviewed` (boolean).
  **Not added to `metadata.required`** — the step machine enforces them behaviorally (missing
  = not reviewed), and omitting them from `required` keeps in-flight artifacts schema-valid
  without migration (see §11).
- `discovery_log` lens enum += `data`. `design` is **retained** in the enum as a legacy value:
  the schema is the backward-compatible superset, the policy is the active vocabulary, and
  `recordAnswer` rejects `design` at write time. Old artifacts stay valid; new entries cannot
  use it.

`template.yaml`: `scenarios: []`; `metadata.discovery_reviewed: false`;
`metadata.scenarios_reviewed: false`.

`bin/validate-templates.ts`: add `scenarios` to `expectedKeys.requirements` (strengthens the
template check; extra keys already pass, missing keys fail).

### 6.8 Error codes

Added to `src/policies/errors.yaml` (with fix hints), each with a unit test:

| Code | Condition |
|---|---|
| `STAGE_POLICY_MISSING` | `requirements-policy.yaml` absent from the stage folder |
| `STAGE_POLICY_INVALID` | Unparsable YAML or shape-validation failure (names the field) |
| `UNKNOWN_LENS` | `--record-answer` lens outside `discovery.lenses` |

### 6.9 Engine change: `completeStep`

`completeStep()` in `authoring.ts` currently hardcodes `assumptions`, `delta`, `init`. Extend
with `discovery` → `metadata.discovery_reviewed = true` and `scenarios` →
`metadata.scenarios_reviewed = true`. This follows the existing precedent (`assumptions` is
likewise a stage-declared extra step recognized by the generic kind). A generalized
flag-driven mechanism was considered and deferred (see §8).

## 7. Change inventory

| File | Change |
|---|---|
| `src/stages/requirements/requirements-policy.yaml` | Replaced with §6.2 content (lenses load-bearing, anchors, refined clarity levels) |
| `src/stages/requirements/hooks.ts` | Fail-loud `loadPolicy` (distinguish missing vs invalid via `existsSync`); delete fallback map; lens validation in `recordAnswer`; shape validation; gate output += `valid_lenses`, `clarity_anchor`, `confirmed`; `extraStep` += scenarios logic; `getExtraData` += scenarios state |
| `src/stages/requirements/steps.yaml` | Reworded `discovery` (two-phase exit); new `scenarios` step; `drafting` += EARS guidance |
| `src/stages/requirements/schema.yaml` | §6.7 |
| `src/stages/requirements/template.yaml` | §6.7 |
| `src/stages/requirements/structural-checks.yaml` | §6.4 + §6.6 check declarations |
| `src/stages/requirements/semantic-checks.yaml` | += 4 advisories (§6.6) |
| `src/scripts/lib/kinds/authoring.ts` | `completeStep` += discovery/scenarios |
| `src/policies/errors.yaml` | += 3 error codes |
| `bin/validate-templates.ts` | `expectedKeys.requirements` += `scenarios` |
| `test/unit/` | Policy pin test (reads the real file, asserts exact lenses/thresholds/anchors); gate behavior per clarity level; missing/corrupt policy → error codes; `UNKNOWN_LENS`; `completeStep` flags; error-catalog presence |
| `test/e2e/` | Full requirements flow through scenarios (incl. loop-back and promotion); bad-lens rejection |
| `AGENTS.md` | One sentence in §5: stage-local config files read by hooks are fail-loud and pinned by unit tests |

## 8. Rejected alternatives (recorded)

| Alternative | Why rejected |
|---|---|
| Extract change identification into a separate intake stage | Category error: identification creates the change root every stage presupposes; no fitting kind; acceptance-gate ceremony (review cycle or gate exception) disproportionate to a one-line decision; request text is designed to evolve during discovery. |
| Option A: delete policy file, keep fallback constants | Loses visible-in-YAML thresholds; stage folders are the structural source of truth. |
| Option C: status quo (dual source) | Silent drift between file and fallback; half-dead config. |
| Raise question thresholds (8 → 12, etc.) | Moves the satisficing line; taxes every request with user round-trips; the real lever is the exit judgment, not the count. |
| Examples as output only (current flow) | Wastes the strongest elicitation instrument; edge cases emerge from concrete examples, not abstract questioning. |
| Draft ACs directly during scenarios | Schema-invalid mid-flow (`parent_id` required); conflates draft examples with accepted criteria; loses the mechanical example→outcome mapping. |
| Full BDD / executable specifications | No test-runner integration in the toolkit; ACs are prose by design. |
| MoSCoW prioritization, glossary section | Unit of work is a single change request; `out_of_scope` covers exclusion; low observed frequency of term-ambiguity failures. Revisit on evidence. |
| Over-specification generally | Requirements-fixation research: excessive detail degrades downstream design quality. Goal is resolved ambiguity, not volume. |
| New structural check types for scenario integrity | `ref-exists` (string refs, optional fields) already expresses everything needed; catalog stays capped at eleven. |
| Generalized `completeStep` (flag-driven, any step) | Engine generality not justified by two new flags; minimal extension matches the `assumptions` precedent. |
| Structural EARS check now | Would need new regex-pattern check logic in the catalog = design-review event; advisory first, structural later if advisories prove insufficient. |

## 9. Invariant compliance

| Invariant | Status |
|---|---|
| 1. Stage folders are source of truth | ✅ Policy and all behavior declared in the stage folder; engine change is two flag assignments |
| 2. CLI owns lifecycle transitions | ✅ Unchanged |
| 3. Review history append-only | ✅ Untouched |
| 4. Living docs via knowledge extraction only | ✅ Untouched |
| 5. Authoring stages produce delta entries | ✅ Unchanged |
| 6. Implementation state in plan.yaml | ✅ Untouched |
| 7. Agent-agnostic | ✅ No agent paths |
| 8. Envelope shape frozen | ✅ New fields only inside `data` |
| 9. Deployed skill is a build artifact | ✅ Whole-folder copy ships the policy automatically; `deploy:smoke` verifies |
| 10. Stage discovery by directory | ✅ No new stages |
| 11. Validation declarative, capped catalog | ✅ Only existing checks with new params; policy shape validation is config loading, not artifact validation |
| 12. Gate semantics | ✅ Untouched |

## 10. Verification plan

1. `npm run validate` — mandatory (code + YAML changed).
2. `npm run test:unit` — new unit tests per §7.
3. `npm run test:e2e` — full pipeline including the scenarios flow.
4. `npm run deploy:smoke` — bundle includes the policy file; smoke passes.
5. Manual: `sdlc requirements --request "…"` in a temp dir; walk
   discovery → confirm → scenarios (with one open scenario looping back) → assumptions →
   drafting (EARS + promotion) → finalize; verify envelope fields at each step.

## 11. Migration and rollout

- **In-flight change directories**: no migration required. New metadata flags are optional in
  the schema; the step machine treats missing as "not reviewed", so an in-flight artifact
  simply shows the discovery/scenarios steps until confirmed. Legacy `design`-lens
  `discovery_log` entries remain schema-valid.
- **Deployed skill**: regenerated by deploy; the policy file ships via the existing
  whole-folder stage copy. No deploy-logic change.
- **Rollback**: revert the stage folder + the two-line `completeStep` extension; artifacts
  with `scenarios` sections and new flags remain readable (schema-tolerant consumers).

## 12. Decisions (resolved 2026-08-24)

1. **EARS enforcement level** — advisory only (as specified). Escalate to a structural catalog
   check only on evidence of insufficient compliance; that escalation is a design-review event.
2. **Divergence check placement** — resolved by the unified validation architecture, no extra
   work: the review kind loads the *tracked* stage's semantic checklist
   (`semanticChecksFor(trackedStage)`, review.ts) and runs `validateArtifact(trackedStage.id, …)`,
   so a check declared in `src/stages/requirements/semantic-checks.yaml` is presented to the
   authoring agent at `--finalize` **and** re-presented to the reviewer agent at
   requirements-review. One declaration, two enforcement points. Review stages carry no
   `semantic-checks.yaml` of their own (CMP-009) and none is added.
3. **Scenario categories** — the four (`happy|edge|negative|boundary`) are the starting
   taxonomy; revisit once real changes flow through.
4. **Policy override path** — deferred until demonstrated need (the deployed copy is a build
   artifact; the durable edit point is this repo).

## Appendix: decision points confirmed during analysis

- Option B (policy as single source of truth, fail-loud) — confirmed.
- Lenses: −`design`, +`data`, `outcome` required for vague — confirmed.
- Thresholds held at 3/5/8 — confirmed.
- Discovery exit confirmation (`discovery_reviewed`) — confirmed.
- Scenarios step with dedicated artifact section and catalog-only enforcement — confirmed.
- LLM-first principles (§3) adopted as the governing design frame — confirmed by owner.
- Divergence check enforced at both finalize and review via unified validation (one
  declaration in the requirements stage's semantic-checks.yaml; no review-stage file changes) —
  confirmed by owner, 2026-08-24.
- EARS advisory-only, four scenario categories, policy override deferred — confirmed by owner,
  2026-08-24.
