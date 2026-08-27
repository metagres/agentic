---
name: agent-audit
description: Development-only audit of the agent roster and model catalog. Fetches the live opencode model list, refreshes the schema enum, reassigns each agent's LLM with web-grounded justification, realigns parameters and permissions with stage purpose, deduplicates/adds/removes agents with stage.yaml rebinding, and never overwrites an existing model_override. Invoked manually by the maintainer; never deployed.
inputs:
  - Live endpoint GET http://opencode.ai/zen/go/v1/models
  - src/schemas/agent.schema.yaml (model catalog enum)
  - src/agents/*.yaml (agent roster)
  - src/stages/<stage-id>/stage.yaml (agent bindings)
outputs:
  - Refreshed model enum in src/schemas/agent.schema.yaml
  - Reassigned/realigned agent definitions under src/agents/
  - Updated stage.yaml bindings where the roster changed
  - A grounding report naming the web sources behind each assignment
---

# Agent Audit (Dev-Only)

Manual maintenance pass for the agent roster and the opencode model catalog. This skill is
**development-only**: it is never bundled or deployed, and it is the **only** place in the toolkit
where LLM judgment drives configuration. Everything it leaves behind must pass deterministic
validation (`npm run validate`).

## 0. Principles

- **Fetch first, write later**: no file is touched until the live catalog is in hand.
- **Deterministic runtime**: all judgment happens here, at dev time. Never edit validation,
  deployment, or CLI code to encode an audit decision.
- **Recommendation preserved**: `model` is the team recommendation; `model_override` is a
  personal free-form choice that always wins (`effectiveModel = model_override ?? model`) and is
  **never overwritten by this audit**.
- **Operate within invariants**: do not touch the capped check catalog, the frozen CLI envelope,
  the stage-folder layout, or anything under `.opencode/` (build artifact).
- **Reviewable output**: every change lands in the git diff; record grounding sources for human review.

## 1. Fetch the Live Catalog (abort on failure)

`GET http://opencode.ai/zen/go/v1/models` expecting `{object: 'list', data: [{id, owned_by, created?}]}`.

- On any **non-2xx** response: **fail immediately**, naming the URL and the received HTTP status.
  Rewrite **zero** files — the previous catalog stays authoritative.
- On success, build the qualified stored form for every entry: `opencode/<id>` (the `owned_by`
  value is the provider prefix). Example: bare id `kimi-k3` with `owned_by` `opencode` stores as
  `opencode/kimi-k3`.

## 2. Refresh the Enum and Migrate Prefixes

Rewrite the `model.enum` in `src/schemas/agent.schema.yaml` to **exactly** the sorted
(alphabetically) set of qualified ids from step 1 — no extra entries, none missing.

Then migrate legacy values: replace every `opencode-go/<id>` occurrence with `opencode/<id>` in

- the schema enum itself (if a rewrite pass ran before the migration), and
- every `model:` field under `src/agents/*.yaml`.

After this step **no `opencode-go/` prefix survives anywhere under `src/schemas/` or `src/agents/`**,
and no unfetched id remains. If an agent's current model id disappeared from the live list, its new
model comes from step 3 (the override field, if present, is untouched).

## 3. Reassign Each Agent's Model (web-grounded)

For each agent under `src/agents/`:

1. Read the bound stage (`agent:` field in `src/stages/<stage-id>/stage.yaml`; an agent may bind to
   several stages). Understand the stage's purpose from its descriptor, steps, and template.
2. Consult trusted web sources (vendor documentation, public benchmarks) on each candidate model's
   capabilities against that purpose — e.g. code-generation capability for implementation-stage
   agents, long-context analysis for review-stage agents.
3. Assign the best-fit **qualified id from the freshly fetched list** to the agent's `model` field.
4. Record which sources grounded the assignment (URLs/names) in your output report, one row per agent:

   | Agent | Stage(s) | Assigned model | Grounding sources | Rationale |

5. **Never modify an existing `model_override` field.** If present, skip the model assignment for
   that agent entirely (its effective model is the override regardless of `model`).

If web coverage for a candidate is missing, fall back to vendor documentation or the id's own
signals and say so in the report.

## 4. Realign Temperature, Description, System Prompt

Per agent, judge `temperature`, `description`, and `system_prompt` against the bound stage's
instructions:

- Rewrite only fields you judge **better aligned** after the change; leave already-aligned fields
  byte-identical.
- Keep prompts neutral personality prose: they must stay free of CLI flags, script paths, and
  envelope directive phrases (the purity-marker check fails otherwise).
- An agent bound to multiple stages must serve the union sensibly; prefer the most restrictive
  common ground and note the tension in the report.

## 5. Auto-Fix Permissions

Reuse the engine's deterministic semantics from `src/scripts/lib/agent-permissions.ts`:

- `computeEffectivePermissions(stage)` — the stage kind's contract overridden by the stage
  descriptor's `permissions` map (only `allow`/`deny` overrides apply).
- `checkAgentCompatibility(stages, agents)` — floors must be `allow`, ceilings must be `deny`;
  across multiple bindings of one agent, floors union and ceilings intersect.

For every binding, compare the agent's declared permissions against the effective requirements and
rewrite the agent file until the check passes for **every** bound stage. Findings name stage, agent,
and key — loop until empty. Introduce no new permission keys or vocabulary.

## 6. Manage the Roster (dedupe / add / remove)

All mutations must keep every file valid against `src/schemas/agent.schema.yaml` and every stage
descriptor valid against the stage meta-schema.

| Operation | Rule |
|-----------|------|
| Dedupe | Two definitions identical (byte-identical, or semantically identical after the audit): keep exactly **one** survivor file, delete the redundant YAML under `src/agents/`, and repoint every `stage.yaml` `agent:` field referencing a deleted id to the survivor. |
| Add | A stage's purpose is not well served by any existing agent: create a new valid `<agent-id>.yaml` under `src/agents/` (id equals filename stem) and bind it in that stage's `stage.yaml`. |
| Remove | An agent referenced by no stage and judged redundant: delete its YAML and any dangling references. |

After roster changes, verify every `stage.yaml` `agent:` reference resolves — unresolved references
are hard validation errors.

## 7. Finish Only When Validation Is Green

Run `npm run validate`. The run must exit 0 with zero findings across schemas, policies, templates,
typecheck, and unit tests. Typical failures and fixes:

| Failure | Fix |
|---------|-----|
| Model outside the fresh enum (names file and value) | Reassign from the fetched list (step 3). |
| Empty `model_override` (AGENT_MODEL_OVERRIDE_EMPTY) | Set a non-empty free-form id or remove the field — never leave it empty. |
| Unresolved stage agent reference | Repoint or restore the binding (step 6). |
| Permission incompatibility (names stage, agent, key) | Continue the auto-fix loop (step 5). |
| Prompt purity marker violation | Reword the system prompt (step 4). |

Finish with the grounding report from step 3 and a summary of roster changes. The reviewable git
diff plus the green gate are the acceptance controls; human review happens through the normal
review stages.

## 8. Scope Limits

- Do **not** touch anything under `.opencode/` — it is a build artifact.
- Do **not** add the audit skill to the deployed bundle; deployment ships exactly `agentic-sdlc`
  and `knowledge-init`.
- Do **not** introduce network calls, LLM calls, or new error codes into validation/deployment/CLI
  code to support an audit outcome.
- Do **not** schedule or automate this audit; the maintainer invokes it manually when the catalog
  or stage instructions change.
