# api-contract.md

CLI toolkit: no HTTP endpoints. The contract surface is the `sdlc` command line and the frozen JSON envelope.

## Endpoints (CLI Commands)

| Method | Path | Auth | Request Shape | Response Shape | Source File | Schema Drift? |
|--------|------|------|---------------|----------------|-------------|---------------|
| CLI | sdlc --help / --version / --list-workflows | none (local process) | no args | envelope, data.workflows (each entry carries agent: id or null) | src/scripts/sdlc.ts | No |
| CLI | sdlc <stage-id> --change <change-name> [kind flags] | none | --change + flags per kind (authoring: --request, --finalize, --confirm-semantic, --help-step, --record-answers <file>; review: --accept, --reject, --failures <file>, --dry-run; tasks: --task-id, --status, --note — required for --status done, else TASK_DONE_REQUIRES_NOTE) | frozen envelope | src/scripts/workflows/index.ts, src/scripts/lib/kinds/ | No |
| CLI | sdlc status --change <change-name> | none | --change | envelope, data.pipeline (per-stage agent: id or null) | src/scripts/workflows/status.ts | No |
| CLI | sdlc feedback --change <change-name> --from <stage> --to <stage> --reason "..." [--resolve <FB-id>] | none | --change, --from, --to, --reason, optional --resolve | frozen envelope | src/scripts/workflows/feedback.ts | No |
| CLI | sdlc doctor [--strict] | none | --strict optional | envelope with checks list | src/scripts/workflows/doctor.ts | No |
| CLI | node bin/deploy-to-agent.ts --dest <root> [--clean] [--skip-smoke] | none | dest, clean, skip-smoke | JSON report with skills array | bin/deploy-to-agent.ts | No |
| CLI | node bin/lint-artifact.ts <stage> <artifact> | none | stage id, artifact path | validateArtifact findings | bin/lint-artifact.ts | No |
| CLI | node bin/validate-{schemas,policies,templates}.ts | none | none | validation report; templates bin adds skills array | bin/validate-schemas.ts, bin/validate-policies.ts, bin/validate-templates.ts | No |
| CLI | node src/skills/improvement-review/scripts/measure_artifacts.ts [--change <slug>] [--verbose] | none | optional --change slug filter, --verbose | artifact line-count rows per change under docs/changes/ (default ≤40-line summary; --verbose per-file); exit zero on empty datasets, non-zero naming unreadable paths | src/skills/improvement-review/scripts/measure_artifacts.ts | No |
| CLI | node src/skills/improvement-review/scripts/envelope_sizes.ts --change <slug> [--verbose] | none | required --change slug, --verbose | per-stage envelope byte rows (stage, step, bytes_total, bytes_per_field) for the nine stages; internally invokes the sdlc CLI per stage with mandatory --dry-run on the four review-stage invocations (bare review invocations open or refresh an open round; only verdicts append when no open round exists); byte-identical for identical repository state | src/skills/improvement-review/scripts/envelope_sizes.ts | No |
| CLI | node src/skills/improvement-review/scripts/mine_transcript.ts <file>... [--verbose] | none | one or more caller-supplied transcript files (never discovered), --verbose | event counts (sdlc invocations per command token, wasted-round candidates, delegation events with type=/model=/rework= sub-fields) with source filename beside every number; zero parseable events → explicit zero-extraction report + non-zero exit | src/skills/improvement-review/scripts/mine_transcript.ts | No |
| CLI | node src/skills/improvement-review/scripts/validate_duration.ts [--verbose] | none | --verbose | shape-stable fast-gate timing record (command, exit_code, duration_ms); duration_ms varies with machine and load — shape stability, not byte-identity; propagates validate failure non-zero with named cause | src/skills/improvement-review/scripts/validate_duration.ts | No |

- Authoring change creation: `--change` together with `--request` with no matching change directory creates the change under the exact provided slug, which must match `^[a-z0-9][a-z0-9-]*$` (max 60 chars, no trailing hyphen) and be unique among existing changes (errors `INVALID_CHANGE_SLUG` / `CHANGE_DIR_EXISTS`). Bare `--request` keeps the mechanical word-boundary fallback (slugify plus numeric suffix); an existing `--change` directory keeps resume semantics. Evidence: src/scripts/lib/ids.ts (validateChangeSlug), src/scripts/lib/kinds/authoring.ts (createChangeDir), src/policies/errors.yaml.

- Review round lifecycle (failure-only, evidence-backed): a bare review invocation opens an inspection round — or refreshes the existing open round in place with its round number frozen — instead of appending a content-free round; a verdict invocation (`--accept`/`--reject`) completes the latest open round in place, appending a round only when no open round exists. Rounds carry a merged `status` (open \| accepted \| rejected; legacy rounds without a status field are treated as closed), `mechanical_checks_passed` (bool), `semantic_checks_passed` (bool) only when the semantic checklist was dispositioned (accepted rounds true, `--reject --failures` rejections false), and a uniform `failures` array of `{check, evidence}` — `[]` when accepted, CLI-computed mechanical failures (severity/category stripped, fix folded into evidence) when mechanical checks fail, reviewer-supplied semantic failures otherwise; rounds never record passed checks. `--accept` with passing mechanicals accepts bare (no findings file); `--accept` with any mechanical finding is a forced rejection — the round is recorded rejected and the artifact is flipped to rejected with a blocked envelope (REVIEW_NOT_PASSING). `--reject` with mechanical findings needs no input; `--reject --failures <file>` with passing mechanicals records the failed semantic checks (top-level YAML list of `{check, evidence}`, each check declared in the target stage's semantic-checks.yaml, non-empty evidence, no duplicates, no completeness requirement). Everything else is refused with nothing written: bare `--reject` with passing mechanicals, `--failures` with `--accept` or without `--reject` or while mechanical failures exist, malformed failures files (FAILURE_ENTRY_INVALID, SEMANTIC_FAILURE_INVALID), an accepted tracked artifact (any invocation — already accepted; re-review requires the author to update and re-finalize), and a rejected one (gate-blocked). The removed `--note` flag is refused with a migration message, as is the renamed `--findings` flag. Evidence: src/scripts/lib/kinds/review.ts, src/scripts/lib/review-findings.ts, src/scripts/lib/requires-graph.ts, src/policies/errors.yaml.

## Envelope

<!-- docs-gen:begin id="api-contract-envelope" -->
| Field | Type | Notes | Evidence |
| --- | --- | --- | --- |
| data | object | command-specific payload | src/schemas/cli-envelope.schema.yaml |
| errors | object[] | {code, message, fix?} from errors.yaml | src/schemas/cli-envelope.schema.yaml |
| instructions | string | agent-facing next action; bound stages prepend a delegation directive paragraph (see below) | src/schemas/cli-envelope.schema.yaml |
| state | ok \\| in_progress \\| blocked \\| complete | CLI response state | src/schemas/cli-envelope.schema.yaml |
| step | string | internal step name | src/schemas/cli-envelope.schema.yaml |
| warnings | object[] | advisory findings | src/schemas/cli-envelope.schema.yaml |
| workflow | string | command or stage id | src/schemas/cli-envelope.schema.yaml |
<!-- docs-gen:end id="api-contract-envelope" -->

- Envelope top-level fields are frozen: no new fields may be added. Evidence: src/schemas/cli-envelope.schema.yaml (additionalProperties: false).
- `data.workflows[]` entries (from `--list-workflows` / `--help`) and per-stage entries in `data.pipeline` (from `status`) each carry an `agent` field: the bound agent id or null. Cross-cutting commands (status, feedback, doctor) are always null. The envelope top-level shape is unchanged.
- Bound-stage envelopes prepend a delegation directive to `instructions`: composed at the single envelope funnel (`normalizeEnvelope` resolving the workflow id via `getStageById`) from the declarative `StageRecord.agent` binding — it names the bound agent and instructs delegating the stage to that agent unless the caller already is that agent or that agent is unavailable in the runtime; review-kind stages phrase it so the round is performed by the named reviewer agent, not the authoring agent. Null-binding/cross-cutting commands resolve to no stage record and emit no directive (byte-identical output); the seven top-level fields are unchanged. Evidence: src/scripts/lib/delegation.ts, src/scripts/lib/cli.ts (normalizeEnvelope).
- `data.step_help` (current step's title, markdown, commands, exit_criteria) is omitted from authoring envelopes unless the invocation passes `--help-step`; the seven top-level fields are unchanged. Evidence: src/scripts/lib/kinds/authoring.ts.
- `data.metadata` in authoring envelopes mirrors the artifact's metadata object verbatim and contains no step key: artifacts no longer persist one (instantiation and finalization write no step key, the requirements/design/planning stage schemas forbid the property, and a one-time sweep removed the legacy lines), so the envelope's top-level `step` field — recomputed from artifact state on every call — is the single source of truth for step-machine state. The seven top-level fields are unchanged. Evidence: src/scripts/lib/kinds/authoring.ts, src/stages/requirements/schema.yaml.
- `data.semantic_complete` in authoring envelopes is derived from artifact status, not hardcoded: true exactly when the status is `ready-for-review` or `accepted` (reachable only through `--finalize --confirm-semantic`), false for `draft`, `rejected`, and a missing artifact; a post-finalize mutation that resets the status to `draft` reports false again. Evidence: src/scripts/lib/authoring-base.ts (getData).
- `data.review_failures` in authoring envelopes appears on the recovery step only: the failures of the latest rejected round, read from the review stage's round store (the review stage found by registry reverse-lookup on `reviews === stage.id`, then its `reviewFile`), each entry `{check, evidence}`; omitted when no rejected round exists. The seven top-level fields are unchanged. Evidence: src/scripts/lib/kinds/authoring.ts (loadReviewFailures).
- Agent descriptors accept an optional `model_override`: a non-empty free-form string, deliberately not constrained by the model catalog enum. `effectiveModel = model_override ?? model` is computed in the registry (AgentRecord.effectiveModel) and written into rendered deploy frontmatter, while the source `model` field stays the enum-checked team recommendation. Evidence: src/schemas/agent.schema.yaml, src/scripts/lib/agent-registry.ts, src/scripts/lib/deploy/platforms/opencode.ts.
- `data.workflows[]` and `data.pipeline` stage entries additionally surface `model` (recommended) and `effectiveModel` (model_override ?? model) for bound agents, alongside the unchanged `agent` binding id; unbound/cross-cutting entries omit both. Evidence: src/scripts/workflows/index.ts, src/scripts/workflows/status.ts.
- Resolution-failure envelopes for a missing `docs/changes` directory name the resolved project root as the searched location — `docs/changes does not exist under <root> (searched: <root>/docs/changes). Run from the project root or pass the root explicitly with --cwd <project-root>.` — replacing the former create-a-change-first instruction; the searched path rides the existing `data.searched` field (also carried by `requireChangeRoot`'s missing-`--change` branch and doctor's failed `change_name` check) instead of new envelope surface, and the seven top-level fields are unchanged. Evidence: src/scripts/lib/resolve-root.ts (changesDirFor, resolveRootOrError), src/scripts/lib/change-root.ts (requireChangeRoot), src/scripts/workflows/doctor.ts.
- Authoring artifact creation is gated: every path that first-creates a non-root authoring artifact (change creation with `--request`, lazy instantiation, `ensureArtifact`) evaluates the acceptance gate over the stage descriptor's `requires` list and, when unsatisfied, returns a blocked envelope with `STAGE_GATE_BLOCKED` and `data.unsatisfied_requirements` (each entry naming the required stage, its artifact's current status, and the required status) without writing the artifact file; stages with an empty `requires` list skip the gate, finalize-time gate semantics are unchanged, and the `based_on_requirements`/`based_on_design` keys no longer appear in envelope `data` or artifact metadata. Evidence: src/scripts/lib/kinds/authoring.ts (CreationBlockedError), src/scripts/lib/requires-graph.ts (evaluateGate).

## Internal APIs

| Function | Purpose | Source File |
|----------|---------|-------------|
| loadAgentRegistry(cwd) | scans src/agents/ for YAML, validates each against agent.schema.yaml, returns the cached AgentRecords exposing model, modelOverride (string \| null), and effectiveModel (model_override ?? model); systemPrompt is the full deploy-time prompt — the YAML system_prompt verbatim, with each agent's output-discipline instructions carried inline; throws naming the offending file | src/scripts/lib/agent-registry.ts |
| checkAgentCompatibility(stages, agents) | verifies every stage-to-agent binding (floors allow, ceilings deny, multi-binding union of floors / intersection of ceilings); deterministic | src/scripts/lib/agent-permissions.ts |
| getRenderer(platform, version?) | resolves platform + version to a renderer; latest is the default; throws PLATFORM_UNKNOWN listing supported platforms/versions | src/scripts/lib/deploy/platforms/index.ts |
| renderAgent(renderer, agent) | renders one neutral agent definition into the platform's native format (target-relative path + full content) | src/scripts/lib/deploy/platforms/ |

## Schema Reconciliation

<!-- docs-gen:begin id="api-contract-schema-reconciliation" -->
| Schema File | Endpoints Covered | Drift |
| --- | --- | --- |
| src/schemas/agent.schema.yaml | agent.yaml definitions (startup validation; model enum-checked, model_override free-form) | No |
| src/schemas/cli-envelope.schema.yaml | all sdlc CLI envelopes | No |
| src/schemas/docs-delta.schema.yaml | docs-delta.yaml artifact written by knowledge-extraction | No |
| src/schemas/stage.schema.yaml | stage.yaml descriptors (startup validation) | No |
<!-- docs-gen:end id="api-contract-schema-reconciliation" -->

## Error Catalog

Every code in src/policies/errors.yaml with its message, fix text, and the source files that emit or reference it (generated):

<!-- docs-gen:begin id="api-contract-error-catalog" -->
| Code | Message | Fix | Emitted at |
| --- | --- | --- | --- |
| MISSING_CHANGE_DIR | A change is required. | Use --change <change-name>. | src/scripts/lib/change-root.ts, src/scripts/lib/kinds/review.ts, src/scripts/workflows/feedback.ts |
| AMBIGUOUS_CHANGE_DIR | Multiple changes match the provided value. | Pass one of the listed candidates as --change. | src/scripts/lib/change-root.ts, src/scripts/lib/kinds/authoring.ts, src/scripts/lib/kinds/review.ts, src/scripts/workflows/doctor.ts |
| CHANGE_DIR_NOT_FOUND | No matching change was found. | Use one of the changes listed in data.available_changes, or create a new change with --request. | src/scripts/lib/change-root.ts, src/scripts/lib/kinds/authoring.ts, src/scripts/lib/kinds/review.ts, src/scripts/workflows/doctor.ts |
| INVALID_CHANGE_SLUG | The provided --change name is not a valid change slug. | Use lowercase letters, digits, and hyphens only; start with a letter or digit; at most 60 characters; no trailing hyphen. | src/scripts/lib/kinds/authoring.ts |
| CHANGE_DIR_EXISTS | A change directory with that exact name already exists. | Use one of the listed changes as --change, or pick a different name. | src/scripts/lib/kinds/authoring.ts |
| ARTIFACT_NOT_FOUND | Required artifact not found. | Run the corresponding stage first. | src/scripts/lib/kinds/review.ts |
| ARTIFACT_PARSE_FAILED | Artifact YAML could not be parsed. | Fix the YAML syntax. | bin/lint-artifact.ts |
| REVIEW_NOT_PASSING | Mechanical checks are not passing. | Fix the recorded failures, re-finalize the artifact, and run the review again. | src/scripts/lib/kinds/review.ts |
| CONFLICTING_DECISION | Conflicting review decision flags. | Use either --accept or --reject, not both. | src/scripts/lib/kinds/review.ts |
| UNKNOWN_COMMAND | Unknown workflow or command. | Use --list-workflows to see available workflows. | src/scripts/sdlc.ts |
| UNKNOWN_STAGE | Unknown stage. | Use a known stage name. | src/scripts/lib/runner.ts, src/scripts/workflows/feedback.ts |
| UNKNOWN_STEP | Unknown step. | Use a known step name. | src/scripts/lib/kinds/authoring.ts |
| INTERNAL_ERROR | Internal error. | Inspect the error details. | bin/lint-artifact.ts, src/scripts/lib/kinds/aggregator.ts, src/scripts/lib/kinds/authoring.ts, src/scripts/lib/kinds/review.ts, src/scripts/lib/kinds/tasks.ts, src/scripts/workflows/doctor.ts |
| PLAN_NOT_FOUND | plan.yaml not found. | Run the planning stage first. | src/scripts/lib/kinds/tasks.ts |
| TASK_NOT_FOUND | Task not found in plan.yaml. | Use a valid TASK-NNN id. | src/scripts/lib/kinds/tasks.ts |
| INVALID_TASK_STATUS | Invalid task status. | Use pending, in_progress, done, blocked, or skipped. | src/scripts/lib/kinds/tasks.ts |
| MISSING_TASK_UPDATE_FIELDS | Task update requires both --task-id and --status. | Provide both --task-id and --status. | src/scripts/lib/kinds/tasks.ts |
| TASK_DONE_REQUIRES_NOTE | Marking a task done requires a non-empty implementation note. | Re-run the update with --note describing what was implemented. | src/scripts/lib/kinds/tasks.ts |
| CANNOT_COMPLETE | Knowledge extraction cannot complete. | Resolve validation errors and mark entries extracted. | (catalog entry only) |
| IMPLEMENTATION_NOT_ACCEPTED | Implementation review is not accepted. | Complete implementation review before completing knowledge extraction. | src/scripts/lib/kinds/aggregator.ts |
| DELTA_TARGETS_GENERATED_REGION | A delta entry targets docs/current content that is machine-generated. | Drop the delta entry — regenerate the region with npm run docs:generate instead of editing generated content by hand. | src/scripts/lib/kinds/aggregator.ts |
| ILLEGAL_STATUS_TRANSITION | Illegal lifecycle status transition. | Follow the lifecycle defined in src/policies/lifecycle.yaml. | (catalog entry only) |
| POLICY_INVALID | A policy file is invalid. | Fix the policy file and rerun validation. | (catalog entry only) |
| STAGE_POLICY_MISSING | The stage policy file is missing. | Restore requirements-policy.yaml in the requirements stage folder. | src/stages/requirements/hooks.ts |
| STAGE_POLICY_INVALID | The stage policy file is invalid. | Fix the named field in requirements-policy.yaml and rerun. | src/stages/requirements/hooks.ts |
| UNKNOWN_LENS | The lens is not in the policy vocabulary. | Use one of the lenses listed in requirements-policy.yaml. | src/stages/requirements/hooks.ts |
| DOCS_INDEX_MISSING | docs/current/index.md not found. | Run the knowledge-init skill to create docs/current/index.md. | src/scripts/lib/kinds/aggregator.ts, src/scripts/lib/kinds/authoring.ts, src/scripts/workflows/doctor.ts |
| SCHEMAS_MISSING | No schemas directory found. | Deploy or restore the runtime schemas. | src/scripts/workflows/doctor.ts |
| POLICIES_MISSING | No policies directory found. | Deploy or restore the runtime policies. | src/scripts/workflows/doctor.ts |
| USAGE | Invalid command usage. | Check required flags and try again. | src/scripts/lib/kinds/review.ts, src/scripts/workflows/feedback.ts |
| UNKNOWN_STAGE_FILTER | Unknown stage filter. | Use --stage requirements, design, or planning. | (catalog entry only) |
| MISSING_EXTRACTION_NOTE | Marking a docs-delta entry extracted requires a note. | Provide --note with at least 10 characters. | (catalog entry only) |
| MISSING_MARK_TARGET | Marking extracted requires an entry id or target doc. | Provide --entry-id or --target-doc. | (catalog entry only) |
| ENTRY_ID_NOT_FOUND | No docs-delta entry matched the provided entry id. | Use a valid DD-... entry id from docs-delta.yaml. | src/scripts/workflows/feedback.ts |
| TARGET_DOC_NOT_FOUND | No docs-delta entries matched the provided target doc. | Use a target_doc listed in docs-delta.yaml. | (catalog entry only) |
| UNPLANNED_FILE | A task changed a file not listed in the plan. | Update the plan or explain the incidental change. | src/scripts/lib/kinds/tasks.ts |
| PREVIOUS_STAGE_NOT_READY | A previous stage artifact is not ready or accepted. | Complete the previous stage before finalizing this stage. | src/stages/design/hooks.ts |
| REQUIREMENTS_NOT_READY | Requirements are not ready or accepted. | Complete requirements before finalizing downstream stages. | src/stages/planning/hooks.ts |
| ARTIFACT_INITIALIZED | A new artifact was initialized. | Continue the workflow and fill in the artifact. | src/scripts/lib/kinds/authoring.ts |
| DOCS_DELTA_VALIDATION | Docs-delta validation found problems. | Fix docs-delta entries before completing knowledge extraction. | (catalog entry only) |
| NODE_VERSION_UNSUPPORTED | Node.js version is not supported. | Use Node.js 20 or newer. | src/scripts/workflows/doctor.ts |
| MANIFEST_INVALID | Deployed runtime manifest is invalid. | Redeploy the runtime with bin/deploy-to-agent.mjs. | src/scripts/workflows/doctor.ts |
| STAGE_MISSING_DESCRIPTOR | A stage folder is missing its stage.yaml descriptor. | Create stage.yaml in the stage folder. | (catalog entry only) |
| STAGE_INVALID_DESCRIPTOR | A stage.yaml descriptor is invalid. | Fix stage.yaml to match the stage meta-schema. | src/scripts/workflows/doctor.ts |
| STAGE_UNKNOWN_KIND | A stage descriptor declares an unknown kind. | Use authoring, review, tasks, or aggregator. | (catalog entry only) |
| STAGE_ID_MISMATCH | A stage folder name does not match its descriptor id. | Rename the folder or fix the descriptor id. | (catalog entry only) |
| STAGE_CYCLE | The requires graph contains a cycle. | Remove the cycle from the requires fields. | (catalog entry only) |
| STAGE_MISSING_REFERENCE | A stage requires a stage that does not exist. | Create the stage folder or fix the requires field. | (catalog entry only) |
| CHECK_UNKNOWN | A structural-checks.yaml entry names an unknown check. | Use a check from the capped catalog. | (catalog entry only) |
| CHECK_INVALID_PARAMS | A structural-checks.yaml entry carries malformed parameters. | Fix the check parameters for the named check. | (catalog entry only) |
| STAGE_GATE_BLOCKED | A stage cannot run because a required stage is not accepted. | Complete and accept the required stage before running this stage. | src/scripts/lib/kinds/aggregator.ts, src/scripts/lib/kinds/authoring.ts, src/scripts/lib/kinds/review.ts, src/scripts/lib/kinds/tasks.ts |
| AGENT_SCHEMA_INVALID | An agent definition file fails the agent meta-schema. | Fix the agent file to match agent.schema.yaml and keep its id equal to the filename stem. | (catalog entry only) |
| AGENT_PROMPT_MARKER | An agent system prompt contains CLI or skill instruction markers. | Remove the marker from the system prompt so the personality prose stays neutral. | (catalog entry only) |
| AGENT_REF_UNRESOLVED | A stage.yaml agent reference does not resolve. | Reference an agent id defined in src/agents/ or remove the stage binding. | (catalog entry only) |
| AGENT_PERMISSION_INCOMPATIBLE | A stage-to-agent binding violates the permission compatibility check. | Align the stage's permission contract with the agent's declared permissions. | (catalog entry only) |
| AGENT_MODEL_OVERRIDE_EMPTY | An agent definition declares an empty model_override. | Set model_override to a non-empty free-form model id or remove the field. | src/scripts/lib/agent-model-fields.ts |
| AGENT_MODEL_OUTSIDE_CATALOG | An agent definition's model is not a member of the current catalog enum. | Set model to a qualified id from the current catalog enum in agent.schema.yaml. | src/scripts/lib/agent-model-fields.ts |
| PLATFORM_UNKNOWN | Deployment platform or version selection does not resolve. | Use a known platform and version for the deployment target. | (catalog entry only) |
| FAILURE_ENTRY_INVALID | A --failures entry is not a {check, evidence} object with non-empty check and evidence. | Supply both fields on every entry as a top-level YAML list; no other fields are accepted. | src/scripts/lib/review-findings.ts |
| SEMANTIC_FAILURE_INVALID | A --failures entry names a check that is not declared in the target stage's semantic-checks.yaml or duplicates another entry. | Name only declared semantic checks, one entry per failed check, with non-empty evidence. | src/scripts/lib/review-findings.ts |
<!-- docs-gen:end id="api-contract-error-catalog" -->