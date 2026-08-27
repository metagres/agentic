# P11 — Make the Agent Layer Real: Runtime Delegation Loop

| Field | Value |
|---|---|
| Origin | Session retrospective (2026-08), finding F5 of the process-economy review |
| Status | Proposed — not yet scheduled |
| Suggested change slug | `agent-delegation-loop` |
| Prerequisites | One blocking decision left over from the micro-cycle (see §Model-id mismatch) |
| Kind | Feature (engine + deployment + skill-doc surface) |

## Problem

The agent layer shipped complete but has no runtime consumer:

- Stage descriptors bind agents (`stage.yaml` → `agent:`), and the CLI surfaces the binding
  (`data.workflows[].agent`, status pipeline entries `{status, agent}`), but **nothing acts on
  it**. In every session so far, the orchestrating agent read the mapping and simply ran the
  stages itself.
- All four review stages in all cycles were executed and accepted by the **same agent that
  authored the artifact** — the `stage-reviewer` agent never once ran a review. There is no
  separation of duties between author and gatekeeper.
- The six deployed agents are directly invocable (`mode: all`) and delegable, but the toolkit
  gives the primary agent no instruction to prefer delegation when a binding exists.

Infrastructure without a consumer accrues maintenance debt: kind permission contracts must
chase interpreter changes forever, and the roster must be redeployed, for behavior nobody
exercises.

## Evidence (from the dogfooding sessions)

- `data.workflows[].agent` was emitted correctly in every cycle (verified via
  `--list-workflows`: nine stages bound, cross-cutting null) — and was never consumed.
- `implementation-review --accept` was invoked by the orchestrating agent immediately after
  that same agent finished implementation, in all cycles.
- The permission-compatibility mechanism (`checkAgentCompatibility`) never met a real drift
  event; its value is purely preventive today.

## Goal

Close the loop so that a stage bound to an agent actually runs under that agent:

1. **Primary-agent delegation**: when the next stage's binding differs from the agent about
   to run it, the toolkit's own instructions tell the primary agent to delegate the stage to
   the named subagent (Task tool) instead of executing inline.
2. **Review separation**: review stages are executed by the `stage-reviewer` agent, never by
   the authoring agent — at minimum by strong convention in the skill/instructions, ideally
   with a mechanical guard.

## Non-goals

- No changes to the frozen envelope shape (seven top-level fields stay).
- No LLM inside the engine — the CLI keeps emitting declarative data; judgment stays with the
  calling agents.
- No new agent roster entries; the six existing definitions are sufficient.
- No rename/removal of the binding field.

## Design space & open questions

### Q1 — Where does the delegation instruction live?

Options (not mutually exclusive):

- **SKILL.md** (generated at deploy from `SKILL_TEMPLATE` in `bin/deploy-to-agent.ts`):
  already carries one pointer sentence ("check `data.workflows[].agent` … delegate when set").
  Could be strengthened into a rule: "run the stage via the bound agent".
- **Envelope `instructions`**: the CLI knows the current step and the binding; it could prepend
  "Delegate this stage to `<agent-id>`." Free-text field, schema-safe. Risk: instructions get
  noisy for unbound stages (mitigate: only when binding ≠ null).
- **steps.yaml markdown**: per-step prose; already the natural home for "how to work".

Recommendation: envelope `instructions` for the per-stage nudge (it is contextual and cannot
drift from the binding), plus one firmer sentence in SKILL_TEMPLATE.

### Q2 — How does an agent know it IS the bound agent?

Self-delegation guard: if the current agent already is the bound one (all six are `mode: all`,
so a user may be driving `requirements-analyst` directly), delegating to itself is absurd.

- OpenCode does not expose a reliable "my own agent id" to the model. Possible signals: none
  standardized today.
- Pragmatic fallback: phrase instructions conditionally ("if you are not `<agent-id>`,
  delegate; otherwise proceed") and accept that the model judges identity from context.
- Alternatively add an optional `current_agent` hint to envelope `data` populated by the
  runtime via environment variable (OpenCode-specific; would need deploy/runtime support) —
  defer unless Q2 proves painful in practice.

### Q3 — Review separation: convention or mechanism?

- **Convention (cheap)**: review-stage envelopes always name their bound agent
  (`stage-reviewer`) in instructions; SKILL.md states the authoring agent must hand review
  rounds to the reviewer agent.
- **Mechanism (harder)**: the CLI cannot know which agent invoked it (no identity signal).
  A partial guard: review envelopes could include a warning whenever the same session marker
  … not feasible without runtime support. Conclusion: convention now; revisit if a runtime
  identity signal becomes available. Record this limitation honestly in the design artifact.

### Q4 — Model-id mismatch (BLOCKING PREREQUISITE)

During the last micro-cycle, invoking the deployed `implementation-engineer` failed live:

```
Model not found: opencode-go/kimi-k2.7-code. Did you mean: kimi-k2.7-code?
```

Source stores fully qualified `opencode-go/*` ids (a deliberate earlier decision); the OpenCode
renderer passes them through verbatim; the actual runtime resolves Go models under bare ids.
Delegation cannot work until rendered agents reference resolvable models.

Decision needed before or within this change:

- **Option A (recommended)**: renderer-side normalization — the opencode renderer maps
  `opencode-go/<id>` → `<id>` in frontmatter (source stays fully qualified; the mapping table
  gains a model entry; unit tests updated). Matches observed runtime behavior.
- **Option B**: store bare ids in source and qualify at render (reverses the earlier storage
  decision; touches schema enum + six roster files).

### Q5 — Does delegation apply to knowledge-extraction?

The aggregator stage writes living docs through the curator agent. Same mechanism applies;
verify the curator's write permissions cover `docs/current/**` (they do: `file_write: allow`).

## Proposed shape (requirement seeds)

- FR-A: When a stage envelope is emitted for a stage bound to an agent, the system shall name
  that agent in the instructions with a delegation directive, and shall omit the directive
  when the stage is unbound.
- FR-B: When deployment renders agents for the opencode target, the system shall emit model
  references the target resolves (per Q4 decision), verified by deploy smoke.
- FR-C: When a review-stage envelope is emitted, the system shall direct that the review be
  performed by the bound reviewer agent rather than the authoring agent (convention-level
  enforcement, documented limitation).
- FR-D: The generated SKILL.md shall state the delegation rule as part of the workflow.
- NFR: Envelope top-level shape unchanged; engine stays agent-agnostic (directives are
  generated from declarative bindings, not hardcoded agent paths).

Acceptance-criteria seeds: rendered smoke shows resolvable models (negative: unknown model
fails smoke); envelope for `requirements` contains the analyst directive; envelope for an
unbound fixture stage contains none; review envelope names `stage-reviewer`.

## Implementation sketch

1. Renderer model normalization + tests (Q4 decision) — small, isolated.
2. Instruction directives in authoring/review/tasks/aggregator envelope assembly (read binding
   from StageRecord; compose instructions prefix) + routing tests.
3. SKILL_TEMPLATE rule sentence + deploy e2e assertion.
4. Docs: AGENTS.md §5 agent-layer paragraph, api-contract envelope notes, capabilities row.
5. Living-doc deltas via knowledge-extraction as usual.

Waves: (1) renderer fix; (2) directives + skill template (disjoint files, parallel); (3) docs.

## References

- Binding surfacing: `src/scripts/workflows/index.ts` (`listWorkflows`),
  `src/scripts/workflows/status.ts` (pipeline entries).
- Envelope assembly: `src/scripts/lib/kinds/authoring.ts`, `src/scripts/lib/kinds/tasks.ts`,
  `src/scripts/lib/kinds/aggregator.ts`.
- Skill generation: `bin/deploy-to-agent.ts` (`SKILL_TEMPLATE`).
- Renderer/model mapping: `src/scripts/lib/deploy/platforms/opencode.ts`.
- Roster & contracts: `src/agents/*.yaml`, `src/scripts/lib/agent-permissions.ts`.
- Prior decisions: DEC-004 (CLI-data surfacing) and DEC-006 (renderer registry) of change
  `add-agent-agnostic-agent-definitions-deployed-alongside-the-`.

## Kickoff (new session)

```sh
sdlc requirements --change agent-delegation-loop --request "Close the agent delegation loop: stage envelopes direct the primary agent to delegate bound stages to their agents, review stages are performed by the stage-reviewer agent, and rendered agents reference models the target runtime resolves."
```

Resolve Q4 first (model normalization option A/B) — it gates FR-B and any live verification.
