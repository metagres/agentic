# capabilities.md

## Capabilities

| Capability | Evidence | Related Entities | Related Endpoints | Notes |
|------------|----------|------------------|-------------------|-------|
| SDLC pipeline execution (9 stages, config-driven) | src/stages/, src/scripts/lib/stage-registry.ts | Stage Descriptor, CLI Envelope | sdlc <stage-id> | stages discovered by folder scan; kind interprets flags; authoring stages run a six-step tour (needs_input, init, authoring, ready, complete, recovery) with one-call finalize (--finalize --confirm-semantic) |
| Merged acceptance criteria (requirements) | src/stages/requirements/schema.yaml, src/stages/requirements/structural-checks.yaml | Requirements Artifact | sdlc requirements | one acceptance_criteria list (id AC-NNN, Given-When-Then statement, category happy/edge/negative/boundary, parent_id FR/NFR-NNN); no separate scenarios list |
| Pipeline state reporting | src/scripts/workflows/status.ts | CLI Envelope | sdlc status | shows per-stage status + suggested next command |
| Cross-stage feedback | src/scripts/workflows/feedback.ts | Artifact Status | sdlc feedback | reverts a previous stage to draft for corrections |
| Toolkit self-check | src/scripts/workflows/doctor.ts | Stage Descriptor | sdlc doctor | checks contracts, schemas, policies, stages, docs index |
| Unified artifact validation | src/scripts/lib/validate.ts, src/scripts/lib/checks/ | Stage Descriptor | bin/lint-artifact.ts | one validateArtifact path for finalize, review, and external lint |
| Two-skill deployment | bin/deploy-to-agent.ts | Skill Folder | npm run deploy:smoke | ships agentic-sdlc + knowledge-init as self-contained skills |
| Agent configuration | src/agents/, src/scripts/lib/agent-registry.ts, src/scripts/lib/agent-permissions.ts, src/scripts/lib/deploy/platforms/ | Agent Definition, Kind Permission Contract, Platform Renderer | sdlc <stage-id> (delegation), node bin/deploy-to-agent.ts | per-stage agent binding (optional, current-agent fallback); six-agent roster with one shared reviewer; mechanical permission compatibility; platform-configurable deployment with platform-uniform skills |
| Knowledge extraction (delta aggregation) | src/scripts/lib/kinds/aggregator.ts | Docs Delta | sdlc knowledge-extraction | collects deltas from all delta-producing stages; warns DOCS_INDEX_MISSING |
| Living-doc bootstrap | src/skills/knowledge-init/SKILL.md | Skill Folder, Docs Delta | agent skill (not a CLI command) | sole creator of docs/current; runs once |
| Repo context compilation | generate_context.js | — | node generate_context.js | compiles source into llm_context.txt using .contextignore |
| Agent audit (dev-only) | src/skills/agent-audit/SKILL.md | Agent Definition, Skill Folder | agent skill (not a CLI command) | dev-time catalog refresh from GET http://opencode.ai/zen/go/v1/models (sorted opencode/<id> enum, opencode-go/ prefix migration), LLM web-grounded model assignment, temperature/description/system_prompt realignment, permission auto-fix, roster dedupe/add/remove with stage.yaml rebinding |
| Model override | src/schemas/agent.schema.yaml, src/scripts/lib/agent-registry.ts | Agent Definition, Platform Renderer | sdlc <stage-id> (delegation), node bin/deploy-to-agent.ts | recommendation preserved in the enum-checked model field; free-form model_override wins as effectiveModel (not enum-checked); both values surfaced in CLI data |

## Workflows

| Workflow | Steps (≤5) | Entry Point | Exit Point | Evidence |
|----------|-----------|-------------|------------|----------|
| Single stage run | gate check → step machine → artifact validation → status ready-for-review | sdlc <stage-id> --change | artifact ready-for-review | src/scripts/lib/kinds/authoring.ts |
| Review gate | resolve target → validation → append round → --accept/--reject | sdlc <review-stage> --change | artifact accepted or rejected | src/scripts/lib/kinds/review.ts |
| Full pipeline | requirements → reviews → design → design-review → planning → planning-review → implementation → implementation-review → knowledge-extraction | sdlc status | knowledge-extraction complete | src/stages/*/stage.yaml (requires DAG) |
| Task implementation loop | update task status → complete tasks → finalize plan | sdlc implementation --change | implementation_status ready-for-review | src/scripts/lib/kinds/tasks.ts |
| Deploy | build bundle → copy skills + schemas + policies → render agents via platform renderer → smoke test | npm run deploy:smoke | JSON report with skills + agents arrays | bin/deploy-to-agent.ts |
| Verification | schemas → policies → templates+skills → typecheck → tests | npm run validate | exit 0 | package.json (scripts) |
| Knowledge sync | list deltas → update docs/current → mark complete | sdlc knowledge-extraction --change | docs-delta.yaml written, status complete | src/scripts/lib/kinds/aggregator.ts |