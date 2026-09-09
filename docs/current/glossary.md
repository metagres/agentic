# glossary.md

## Entity: Stage Descriptor (stage.yaml)

<!-- docs-gen:begin id="glossary-fields-stage-descriptor" -->
| Field | Type | Nullable | Source |
| --- | --- | --- | --- |
| agent | string | Yes | src/schemas/stage.schema.yaml |
| artifact | string | No | src/schemas/stage.schema.yaml |
| delta_phase | string | Yes | src/schemas/stage.schema.yaml |
| id | string | No | src/schemas/stage.schema.yaml |
| kind | enum: authoring \| review \| tasks \| aggregator | No | src/schemas/stage.schema.yaml |
| next_ids | object | Yes | src/schemas/stage.schema.yaml |
| permissions | object | Yes | src/schemas/stage.schema.yaml |
| produces_delta | boolean | Yes | src/schemas/stage.schema.yaml |
| requires | string[] | Yes | src/schemas/stage.schema.yaml |
| review_file | string | Yes | src/schemas/stage.schema.yaml |
| reviews | string | Yes | src/schemas/stage.schema.yaml |
| schema_from | string | Yes | src/schemas/stage.schema.yaml |
| status_field | string | No | src/schemas/stage.schema.yaml |
| title | string | No | src/schemas/stage.schema.yaml |
| title_default | string | Yes | src/schemas/stage.schema.yaml |
| title_prefix | string | Yes | src/schemas/stage.schema.yaml |
| version | const 1 | No | src/schemas/stage.schema.yaml |
<!-- docs-gen:end id="glossary-fields-stage-descriptor" -->

| Relationships | Type | Target | Source |
|---------------|------|--------|--------|
| requires | DAG edge | another stage id | src/scripts/lib/requires-graph.ts |
| reviews | ownership | authoring/tasks stage | src/stages/*/stage.yaml |
| folder name | identity | id field | STAGE_ID_MISMATCH in src/policies/errors.yaml |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Discovery | every stage is one folder under src/stages/<id>/; no central enumeration | src/scripts/lib/stage-registry.ts |
| Gate | stage runnable only when every required stage's tracked artifact is `accepted`; review stages when theirs is `ready-for-review` or `accepted` | src/scripts/lib/requires-graph.ts |
| Startup | cycle or missing requires reference is a hard startup error | STAGE_CYCLE, STAGE_MISSING_REFERENCE in src/policies/errors.yaml |
| Schema reuse | schema_from validates the artifact against the named stage's schema.yaml instead of a local copy; the local schema.yaml is waived for that stage, and a missing target or local coexistence is a hard startup error | src/scripts/lib/stage-registry.ts, src/stages/implementation/stage.yaml (schema_from: planning) |
| Agent binding | the optional agent field binds a dedicated agent to the stage; absent means the current agent runs it; permissions overrides individual keys of the kind permission contract | src/schemas/stage.schema.yaml, src/scripts/lib/agent-permissions.ts |

## Entity: CLI Envelope

<!-- docs-gen:begin id="glossary-fields-cli-envelope" -->
| Field | Type | Nullable | Source |
| --- | --- | --- | --- |
| data | object | No | src/schemas/cli-envelope.schema.yaml |
| errors | object[] | No | src/schemas/cli-envelope.schema.yaml |
| instructions | string | No | src/schemas/cli-envelope.schema.yaml |
| state | enum: ok \| in_progress \| blocked \| complete | No | src/schemas/cli-envelope.schema.yaml |
| step | string | No | src/schemas/cli-envelope.schema.yaml |
| warnings | object[] | No | src/schemas/cli-envelope.schema.yaml |
| workflow | string | No | src/schemas/cli-envelope.schema.yaml |
<!-- docs-gen:end id="glossary-fields-cli-envelope" -->

| Business Rules | Rule | Location |
|----------------|------|----------|
| Frozen shape | no new top-level fields; additionalProperties: false | src/schemas/cli-envelope.schema.yaml |

## Entity: Artifact Status

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| status | draft \| ready-for-review \| accepted \| rejected \| blocked | No | src/scripts/lib/requires-graph.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Ownership | CLI owns lifecycle state transitions | src/scripts/lib/kinds/authoring.ts, src/scripts/lib/kinds/review.ts |
| Review history | append-only; rounds never deleted or rewritten except completing or refreshing an open round (legacy rounds without a status field are treated as closed) | src/scripts/lib/kinds/review.ts |

## Entity: Review Round (review file rounds[])

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| round | int (1-based; frozen on refresh) | No | src/scripts/lib/kinds/review.ts |
| reviewed_at | ISO timestamp | No | src/scripts/lib/kinds/review.ts |
| artifact_version | string \| null | Yes | src/scripts/lib/kinds/review.ts |
| implementation_status | string \| null | implementation-stage rounds only (roundBase) | src/scripts/lib/kinds/review.ts |
| status | open \| accepted \| rejected (merged field; legacy rounds without the field are treated as closed) | No | src/scripts/lib/kinds/review.ts |
| mechanical_checks_passed | bool (true = zero mechanical failures) | No | src/scripts/lib/kinds/review.ts |
| semantic_checks_passed | bool (true = the declared semantic checklist passed) | Yes (recorded only when the semantic checklist was dispositioned: accepted rounds carry true, rejections with --failures carry false) | src/scripts/lib/kinds/review.ts |
| failures | array of {check, evidence} — uniform shape for CLI-computed mechanical failures and reviewer-supplied semantic failures; [] when accepted | No | src/scripts/lib/kinds/review.ts, src/scripts/lib/review-findings.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Round lifecycle | bare invocations open an inspection round or refresh the existing open round in place (round number frozen); verdicts (--accept/--reject) complete the latest open round in place, appending a round only when no open round exists | src/scripts/lib/kinds/review.ts |
| Legacy rounds | rounds without a status field are treated as closed and never modified | src/scripts/lib/kinds/review.ts (isOpenRound) |
| Failure-only rounds | rounds record failures only — never passed checks; mechanical failures are always CLI-computed from validateArtifact output (fix folded into evidence) and never reviewer-supplied; every mechanical finding blocks by definition | src/scripts/lib/kinds/review.ts, src/scripts/lib/validate.ts |
| Forced rejection | --accept with any mechanical finding is impossible: the round is recorded rejected, the artifact status is flipped to rejected, and the envelope is blocked explaining the fix-first requirement (REVIEW_NOT_PASSING) | src/scripts/lib/kinds/review.ts, src/policies/errors.yaml |
| Evidence-backed rejections | --reject with passing mechanical checks requires --failures <file>: a top-level YAML list of failed semantic checks {check, evidence}, each check declared in the target stage's semantic-checks.yaml, non-empty evidence, no duplicates, no completeness requirement; violations refuse the invocation with nothing written | src/scripts/lib/review-findings.ts, src/policies/errors.yaml |
| Verdict scoping | --failures is valid only with --reject and only while mechanical checks pass; --accept and bare invocations refuse it; the removed --note and --findings flags are refused with migration messages | src/scripts/lib/kinds/review.ts |
| Terminal artifacts | an accepted tracked artifact refuses any invocation (already accepted; re-review requires the author to update and re-finalize); a rejected one is gate-blocked — the review gate admits ready-for-review only | src/scripts/lib/kinds/review.ts, src/scripts/lib/requires-graph.ts |

## Entity: Docs Delta (docs-delta.yaml)

<!-- docs-gen:begin id="glossary-fields-docs-delta" -->
| Field | Type | Nullable | Source |
| --- | --- | --- | --- |
| deltas_applied | integer | No | src/schemas/docs-delta.schema.yaml |
| metadata | object | No | src/schemas/docs-delta.schema.yaml |
<!-- docs-gen:end id="glossary-fields-docs-delta" -->

| Business Rules | Rule | Location |
|----------------|------|----------|
| Creator | written only by `sdlc knowledge-extraction --complete`; the CLI never creates docs/current | src/scripts/lib/kinds/aggregator.ts |
| Source deltas | collected from delta arrays of all delta-producing stages | src/scripts/lib/kinds/aggregator.ts |

## Entity: Plan Task (plan.yaml)

<!-- docs-gen:begin id="glossary-fields-plan-task" -->
| Field | Type | Nullable | Source |
| --- | --- | --- | --- |
| acceptance_ids | string[] | No | src/stages/planning/schema.yaml (schema_from: planning) |
| completed_at | string | Yes | src/stages/planning/schema.yaml (schema_from: planning) |
| complexity | enum: low \| medium \| high | Yes | src/stages/planning/schema.yaml (schema_from: planning) |
| covers | string[] | No | src/stages/planning/schema.yaml (schema_from: planning) |
| depends_on | string[] | Yes | src/stages/planning/schema.yaml (schema_from: planning) |
| description | string | No | src/stages/planning/schema.yaml (schema_from: planning) |
| design_refs | string[] | Yes | src/stages/planning/schema.yaml (schema_from: planning) |
| files | object[] | Yes | src/stages/planning/schema.yaml (schema_from: planning) |
| files_changed | object[] | Yes | src/stages/planning/schema.yaml (schema_from: planning) |
| id | string | No | src/stages/planning/schema.yaml (schema_from: planning) |
| implementation_note | string | Yes | src/stages/planning/schema.yaml (schema_from: planning) |
| started_at | string | Yes | src/stages/planning/schema.yaml (schema_from: planning) |
| status | enum: pending \| in_progress \| done \| blocked \| skipped | No | src/stages/planning/schema.yaml (schema_from: planning) |
| title | string | No | src/stages/planning/schema.yaml (schema_from: planning) |
| type | enum: analysis \| setup \| implementation \| refactor \| test \| verification \| release \| documentation | No | src/stages/planning/schema.yaml (schema_from: planning) |
<!-- docs-gen:end id="glossary-fields-plan-task" -->

| Business Rules | Rule | Location |
|----------------|------|----------|
| Terminal gate | all tasks must be terminal before implementation finalizes | all-tasks-terminal in src/scripts/lib/checks/ |
| Acyclic deps | depends_on must be acyclic and order-consistent | dependency-acyclic, dependency-order in src/scripts/lib/checks/ |

## Entity: Skill Folder (src/skills)

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| SKILL.md | file | No | src/skills/knowledge-init/SKILL.md |
| frontmatter.name | string, equals folder name | No | bin/validate-templates.ts |
| frontmatter.description | non-empty string | No | bin/validate-templates.ts |
| frontmatter.inputs / outputs | string[] | Yes | src/skills/knowledge-init/SKILL.md |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Deployed form | self-contained: no package.json, node_modules, or .ts files; manifest.json carries name, version, deployedAt (cliPath only for skills that ship a CLI) | bin/deploy-to-agent.ts, AGENTS.md §2 |
| Sole creator | knowledge-init is the only component that creates docs/current | src/skills/knowledge-init/SKILL.md |

## Entity: Agent Definition (src/agents/<agent-id>.yaml)

<!-- docs-gen:begin id="glossary-fields-agent-definition" -->
| Field | Type | Nullable | Source |
| --- | --- | --- | --- |
| description | string | No | src/schemas/agent.schema.yaml |
| id | string | No | src/schemas/agent.schema.yaml |
| mode | enum: subagent \| primary \| all | Yes | src/schemas/agent.schema.yaml |
| model | enum: opencode-go/grok-4.5 \| opencode-go/gpt-5.6-luna \| opencode-go/glm-5.3 \| opencode-go/glm-5.2 \| opencode-go/glm-5.1 \| opencode-go/kimi-k3 \| opencode-go/kimi-k2.7-code \| opencode-go/kimi-k2.6 \| opencode-go/longcat-2.0 \| opencode-go/deepseek-v4-pro \| opencode-go/deepseek-v4-flash \| opencode-go/deepseek-v4-flash-vision-exp \| opencode-go/mimo-v2.5 \| opencode-go/mimo-v2.5-pro \| opencode-go/minimax-m3 \| opencode-go/minimax-m2.7 \| opencode-go/muse-spark-1.2-contributor \| opencode-go/qwen3.8-max \| opencode-go/qwen3.7-max \| opencode-go/qwen3.7-plus \| opencode-go/qwen3.6-plus \| opencode-go/hy3 \| opencode-go/ox-alpha-free | No | src/schemas/agent.schema.yaml |
| model_override | string | Yes | src/schemas/agent.schema.yaml |
| permissions | object | No | src/schemas/agent.schema.yaml |
| system_prompt | string | No | src/schemas/agent.schema.yaml |
| temperature | number | No | src/schemas/agent.schema.yaml |
| version | const 1 | No | src/schemas/agent.schema.yaml |
<!-- docs-gen:end id="glossary-fields-agent-definition" -->

| Business Rules | Rule | Location |
|----------------|------|----------|
| Discovery | one YAML file per agent under src/agents/<id>.yaml; no central enumeration | src/scripts/lib/agent-registry.ts |
| Startup | invalid YAML, schema violation, or id/filename mismatch is a hard startup error naming the file | src/scripts/lib/agent-registry.ts |
| Mode default | omitted mode resolves to all — directly invocable AND delegable | src/scripts/lib/agent-registry.ts |
| Purity | system prompts carry role/personality only; CLI/skill markers fail validation | src/scripts/lib/agent-prompt-marker.ts, bin/validate-policies.ts |

## Entity: Kind Permission Contract

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| kind | authoring \| review \| tasks \| aggregator | No | src/scripts/lib/agent-permissions.ts |
| contract | map of neutral permission keys → allow (floor) / deny (ceiling) | No | src/scripts/lib/agent-permissions.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Ownership | engine-owned beside the kind interpreters; changed only with the interpreters | src/scripts/lib/agent-permissions.ts |
| Overrides | stage.yaml permissions map overrides individual keys of the kind contract | src/schemas/stage.schema.yaml, src/scripts/lib/agent-permissions.ts |
| Compatibility | floors must be allow, ceilings must be deny; multi-bound agents satisfy union of floors and intersection of ceilings | src/scripts/lib/agent-permissions.ts |

## Entity: Platform Renderer

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| platform | string (e.g. opencode) | No | src/scripts/lib/deploy/platforms/index.ts |
| version | int (format revision) | No | src/scripts/lib/deploy/platforms/index.ts |
| renderAgent | AgentRecord → RenderedAgent (path + content) | No | src/scripts/lib/deploy/platforms/index.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Registry | deployment-layer registry keyed by platform + version; getRenderer resolves, latest is the default | src/scripts/lib/deploy/platforms/index.ts |
| OpenCode v2 | permission frontmatter map; non-file-write target keys carry the neutral level verbatim; file-write targets (edit, write, apply_patch) carry an object — the neutral level as the `*` catch-all (first, because OpenCode resolves object rules last-match-wins) plus deny patterns for docs/changes/** (change artifacts are modified only via the CLI) | src/scripts/lib/deploy/platforms/opencode.ts |
| OpenCode v1 | legacy tools frontmatter; allow → true, deny → false, ask omitted | src/scripts/lib/deploy/platforms/opencode.ts |
| Translation | file_read → read/list, search → glob/grep, file_write → edit/write/apply_patch, shell → bash, subagent → task, web → webfetch/websearch, question → question | src/scripts/lib/deploy/platforms/opencode.ts |
| Frontmatter | rendered agents/<id>.md header carries description, mode (invocation mode), model, temperature beside the permission/tools map | src/scripts/lib/deploy/platforms/opencode.ts |

## Entity: Agent Audit (src/skills/agent-audit/SKILL.md)

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| location | src/skills/agent-audit/SKILL.md (dev-only, SKILL.md folder protocol) | No | src/skills/agent-audit/SKILL.md |
| inputs | live catalog GET http://opencode.ai/zen/go/v1/models; src/agents/*.yaml; schema enum; stage.yaml bindings | No | src/skills/agent-audit/SKILL.md |
| outputs | rewritten schema enum + agent fields (model, temperature, description, system_prompt, permissions); roster add/remove/dedupe with stage.yaml rebinding | No | src/skills/agent-audit/SKILL.md |
| invocation | manual, by the maintainer; never deployed | No | src/skills/agent-audit/SKILL.md, bin/deploy-to-agent.ts |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Non-2xx fetch | abort naming URL and HTTP status with zero file writes | src/skills/agent-audit/SKILL.md |
| LLM scope | the only component where LLM judgment drives configuration; runtime validation/deployment stay deterministic | src/skills/agent-audit/SKILL.md |
| Post-run gate | finishes only when npm run validate passes with zero findings | src/skills/agent-audit/SKILL.md |
| Override preservation | never modifies an existing model_override | src/skills/agent-audit/SKILL.md |

## Entity: Model Override

<!-- docs-gen:begin id="glossary-fields-model-override" -->
| Field | Type | Nullable | Source |
| --- | --- | --- | --- |
| description | string | No | src/schemas/agent.schema.yaml |
| id | string | No | src/schemas/agent.schema.yaml |
| mode | enum: subagent \| primary \| all | Yes | src/schemas/agent.schema.yaml |
| model | enum: opencode-go/grok-4.5 \| opencode-go/gpt-5.6-luna \| opencode-go/glm-5.3 \| opencode-go/glm-5.2 \| opencode-go/glm-5.1 \| opencode-go/kimi-k3 \| opencode-go/kimi-k2.7-code \| opencode-go/kimi-k2.6 \| opencode-go/longcat-2.0 \| opencode-go/deepseek-v4-pro \| opencode-go/deepseek-v4-flash \| opencode-go/deepseek-v4-flash-vision-exp \| opencode-go/mimo-v2.5 \| opencode-go/mimo-v2.5-pro \| opencode-go/minimax-m3 \| opencode-go/minimax-m2.7 \| opencode-go/muse-spark-1.2-contributor \| opencode-go/qwen3.8-max \| opencode-go/qwen3.7-max \| opencode-go/qwen3.7-plus \| opencode-go/qwen3.6-plus \| opencode-go/hy3 \| opencode-go/ox-alpha-free | No | src/schemas/agent.schema.yaml |
| model_override | string | Yes | src/schemas/agent.schema.yaml |
| permissions | object | No | src/schemas/agent.schema.yaml |
| system_prompt | string | No | src/schemas/agent.schema.yaml |
| temperature | number | No | src/schemas/agent.schema.yaml |
| version | const 1 | No | src/schemas/agent.schema.yaml |
<!-- docs-gen:end id="glossary-fields-model-override" -->

| Business Rules | Rule | Location |
|----------------|------|----------|
| Precedence | effectiveModel = model_override ?? model; deploy renders effectiveModel into frontmatter while source model stays the recommendation | src/scripts/lib/agent-registry.ts, src/scripts/lib/deploy/platforms/opencode.ts |
| Validation | model must be a member of the enum; empty model_override fails naming file and value; free-form non-empty overrides pass | src/scripts/lib/agent-model-fields.ts, src/policies/errors.yaml |
| Surfacing | CLI data exposes both model (recommended) and effectiveModel for bound agents | src/scripts/workflows/index.ts, src/scripts/workflows/status.ts |

## Entity: Improvement Review (src/skills/improvement-review)

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| location | src/skills/improvement-review/SKILL.md (dev-only, SKILL.md folder protocol) | No | src/skills/improvement-review/SKILL.md |
| helpers | four deterministic TypeScript scripts under scripts/ (measure_artifacts, envelope_sizes, mine_transcript, validate_duration) | No | src/skills/improvement-review/scripts/ |
| playbook | dissolved 2026-08-27 after register resolution — the skill is a pure advisor; the method record is the frozen sdlc-improvement-review-skill change artifacts | — | docs/changes/sdlc-improvement-review-skill/ |
| SDLC goals canon | ordered G-NN entries (testable goal statement, grounding sources, status active/amended/retired, created date, amendments); eight active entries | No | docs/current/capabilities.md (## SDLC Goals) |
| What-worked fairness | fairness lives inside proposals: a run producing proposals cites at least one confirmed-working mechanism with dated evidence in a proposal Evidence note; vacuous at zero proposals | No | src/skills/improvement-review/SKILL.md |
| measurement baselines | dated M-NN rows; kind count \| bytes \| timing; unit, command, date, comparability note; two-tier section with authoritative qualitative prose baselines | No | docs/current/operations.md (## Baselines) |
| transcript event grammar | generic line-oriented grammar: invocation events (counted per command token), wasted-round candidates (repeated identical consecutive command lines), ack-repeat candidates (consecutive invocations returning an identical instructions slice; duplicate envelope copies for one invocation never repeat), failure events (envelope error signatures per code, errors-array window only), tool-call failure events (closed-catalog signatures inside a raw or escaped `"error": "` field anchor), source-exploration events (codegraph explores, grep/rg naming src/ paths; per kind), diagnosis-loop candidates (post-block exploration runs; blocked envelope = state:"blocked", error signature, or tool failure; sdlc invocations end runs and disarm), delegation events (type=, model=, rework= sub-fields; missing sub-fields reported unrecorded) | No | src/skills/improvement-review/scripts/mine_transcript.ts, src/skills/improvement-review/SKILL.md |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Evidence-or-label | every claim carries a measurement, count, grep, or sourced observation — or is explicitly labeled an unverified hypothesis naming the missing evidence; nothing in between | src/skills/improvement-review/SKILL.md |
| Goals gate | the goals canon is loaded read-only from capabilities.md before any finding is evaluated; a missing or amendment-worthy goal becomes a docs/ideas proposal stating the proposed entry in canon format; amendments require a dated justification — silent rewrites prohibited | src/skills/improvement-review/SKILL.md |
| Baseline comparison | runs compare read-only against the newest same-kind quantitative row in operations.md and carry deltas inside their proposals; a metric with no recorded row is labeled an initial-baseline candidate; timing rows compare orders of magnitude and regressions, never bytes | src/skills/improvement-review/SKILL.md |
| Fairness minimum | a run producing proposals cites at least one confirmed-working mechanism with dated evidence inside a proposal; a zero-finding run writes nothing and the duty is vacuous | src/skills/improvement-review/SKILL.md |
| Write surface | pure advisor — writes only inside docs/ideas/; canon updates travel only inside proposals and land through the landing change's knowledge extraction | src/skills/improvement-review/SKILL.md |
| Thin-signal check | fewer than two substantive changes since the last review date warns of thin signal and proceeds only after explicit maintainer confirmation — a manual precondition of the invoked run, never an automated trigger | src/skills/improvement-review/SKILL.md |
| Zero extraction | a supplied transcript with zero parseable events yields an explicit zero-extraction report and non-zero exit; session-derived numbers are treated as missing, never zero | src/skills/improvement-review/scripts/mine_transcript.ts |
| Findings taxonomy | every accepted finding carries exactly one canonical class — failed-call, hidden-gate-behavior, instruction-gap, token-waste, permission-conflict — so multi-reviewer output dedups by claim (same class + same cited evidence), not prose | src/skills/improvement-review/SKILL.md (§8.1) |
| Causal-claim verification | every causal claim cites the exact message/tool-call id; contradictory attributions between reviews are resolved against the transcript before a proposal carrying the claim is written | src/skills/improvement-review/SKILL.md (§8.2) |
| Invocation class | envelope measurement splits the nine stages per invocation class — detection (review stages, mandatory --dry-run) vs mutation — so envelope-semantics changes are measurable per class; semantics changes make same-kind byte rows incomparable (initial-baseline candidates) | src/skills/improvement-review/scripts/invocation_class.ts, src/skills/improvement-review/scripts/envelope_sizes.ts |
| Invocation | manual, by the maintainer; never scheduled or automated; never deployed | src/skills/improvement-review/SKILL.md, bin/deploy-to-agent.ts |

## Entity: Idea Document (docs/ideas/<slug>.md)

| Field | Type | Nullable | Source |
|-------|------|----------|--------|
| Origin | string (session, review, or finding the proposal came from) | No | docs/ideas/p12-fast-track-lane.md |
| Status | disposition with a date: Proposed \| Landed in <change-slug> <YYYY-MM-DD> \| Dropped <YYYY-MM-DD> — <reason> \| Superseded by <slug> <YYYY-MM-DD> | No | docs/ideas/*.md header tables |
| Suggested change slug | string (kebab-case change slug) | Yes | docs/ideas/p12-fast-track-lane.md |
| Depends on | string (other proposals or "nothing hard") | Yes | docs/ideas/p12-fast-track-lane.md |
| Kind | string (process/engine feature, docs, tooling) | No | docs/ideas/*.md header tables |
| Cost tier | string (implementation cost estimate) | Yes | docs/ideas/*.md header tables |
| Body | nine-section proposal skeleton with governance test | No | src/skills/improvement-review/SKILL.md |

| Business Rules | Rule | Location |
|----------------|------|----------|
| Queue contract | docs/ideas holds only open proposals; mutable canon lives only in docs/current and changes only via changes | docs/current/conventions.md (File Organization) |
| Landing signature | a landed idea's Status reads exactly "Landed in <change-slug> <YYYY-MM-DD>" (regex ^Landed in \S+ \d{4}-\d{2}-\d{2}$); the signature must never appear on a file still residing in docs/ideas | docs/current/conventions.md (File Organization) |
| Landing move duty | the implementing change's plan carries a documentation task that sets the Status and moves the file unmodified into docs/changes/<change-slug>/ during its implementation stage; implementation-review verifies the landing | docs/current/conventions.md (File Organization) |
| Hosted-file freeze | once the change completes, the hosted idea file is a frozen change artifact; later work references it read-only and never modifies it | docs/current/conventions.md (File Organization) |

## Note: Output-Discipline Text

The output-discipline text lives inline in each `src/agents/<id>.yaml` `system_prompt`, appended after the role voice and separated by one blank line; there is no shared fragment module and no deploy-time composition — rendered agent bodies are the system prompt verbatim.

## Naming Cross-Check

| Backend Term | Frontend Term | Same Concept? | Action |
|--------------|---------------|---------------|--------|
| n/a — single-process CLI toolkit, no backend/frontend split | — | — | — |