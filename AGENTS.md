# AGENTS.md — Mandatory Rules for AI Coding Agents

## 1. The One Rule

Before declaring a change that touches **code or YAML definitions** (anything under
`src/` or `bin/`, a `*.ts`/`*.js` source file, `package.json`, `tsconfig.json`,
`tsup.config.ts`, or any `*.yaml`) complete:

```bash
npm run validate
```

If it fails, the work is not done. No exceptions.

`validate` is the fast gate: schemas + policies + templates + typecheck + unit
tests only (~seconds). End-to-end tests are not part of it — they run through
`check:all`.

Documentation-only changes (e.g. `*.md` files, codemaps, README) do **not** require
`npm run validate`.

For full confidence (unit + e2e tests plus deployment smoke test):

```bash
npm run check:all
```

---

## 2. Invariants (Never Break These)

1. Stage folders are the structural source of truth; stage schemas and the capped check catalog enforce traceability and shape. Cross-file + lint checks enforce consistency.
2. The CLI owns lifecycle state transitions.
3. Review history is append-only; rounds are never deleted.
4. Living docs (`docs/current/`) are updated only through knowledge extraction.
5. Authoring stages produce delta entries; they never edit `docs/current/` directly.
6. Implementation state lives in `plan.yaml`.
7. The toolkit is agent-agnostic — no hardcoded agent paths.
8. The CLI envelope shape is frozen (workflow, step, state, instructions, data, errors, warnings).
9. The deployed skills (`.opencode/skills/agentic-sdlc/` and `.opencode/skills/knowledge-init/`) are build artifacts: exactly two self-contained skill folders, fully bundled with all dependencies inlined (no `package.json`, no `node_modules`, no source `.ts` files inside them). They must never be treated as, or confused with, this repository's own source/config.
10. Stages are discovered by directory: every stage is one folder under `src/stages/<stage-id>/` and no central file enumerates stages.
11. Validation logic is declarative: stages declare named checks from the capped catalog; stage-specific validation scripts are prohibited.
12. A stage is runnable only when every required stage's tracked artifact has status `accepted`; a review stage is runnable when its tracked artifact is `ready-for-review` or `accepted`.

---

## 3. Terminology

| Term | Meaning |
|---|---|
| stage | Main workflow (requirements, design, planning, implementation, knowledge-extraction) plus review gates (requirements-review, design-review, planning-review, implementation-review) |
| kind | Interpreter class of a stage: authoring, review, tasks, aggregator |
| gate | Review checkpoint; also the acceptance gate evaluated from the requires graph |
| step | Internal step inside a workflow |
| state | CLI response state (ok, in_progress, blocked, complete) |
| status | Artifact lifecycle status (draft, ready-for-review, accepted, rejected, blocked) |

Do not conflate these.

---

## 4. Definition of Done

A change is complete when:

- `npm run validate` passes (required when code or YAML definitions changed; documentation-only changes are exempt — see §1).
- No invariant from §2 is violated.
- No new top-level CLI envelope fields were introduced.
- No hardcoded agent-specific paths were added.
- If deployment-related files changed: `npm run deploy:smoke` passes.
- If deploy output changed: confirm `.opencode/skills/agentic-sdlc/` still contains no `package.json`/`node_modules`/source `.ts` files and exactly one `SKILL.md`.
- If behavior changed: relevant docs in this file or referenced docs are updated.

---

## 5. The Stage-Folder Layout

Every stage is one folder under `src/stages/<stage-id>/` holding all of that stage's
configuration. The engine discovers stages by scanning this directory; adding a stage of an
existing kind requires only a new folder — no TypeScript change.

### Per-stage file set (CMP-009)

| Kind | Files the stage carries |
|---|---|
| authoring | `stage.yaml`, `structural-checks.yaml`, `schema.yaml`, `template.yaml`, `steps.yaml`, `semantic-checks.yaml` |
| review | `stage.yaml`, `steps.yaml` |
| tasks | `stage.yaml`, `structural-checks.yaml`, `schema.yaml`, `steps.yaml`, `semantic-checks.yaml` |
| aggregator | `stage.yaml`, `steps.yaml`, `schema.yaml` |

A descriptor may declare `schema_from: <stage-id>` to validate its artifact against the named
stage's `schema.yaml` instead of carrying its own copy — the artifact contract is then declared
once by the owning stage, the local `schema.yaml` is waived for that stage, and a missing target
or local coexistence is a hard startup error. The implementation stage uses this for the shared
`plan.yaml` (`schema_from: planning`).

Optional `hooks.ts` (compiled to `hooks.js` in the bundle) supplies stage-specific behavior
such as the requirements discovery gate; it is the only stage-specific code allowed and never
participates in validation. `stage.yaml` is validated at startup against the engine-owned
meta-schema `src/schemas/stage.schema.yaml`; a missing descriptor, invalid YAML, unknown kind,
or folder/id mismatch is a hard startup error naming the folder. Two optional descriptor
fields bind a stage to a dedicated agent: `agent` (the agent id; absent means the current
agent runs the stage) and `permissions` (per-key `allow`/`deny` overrides of the stage
kind's permission contract).

### The agent layer

Agents are optional engine-level definitions, one YAML file per agent under `src/agents/`,
discovered by directory scan (never enumerated centrally). Each `<agent-id>.yaml` declares
identity, description, model, temperature, an optional `mode` (`subagent`, `primary`, or
`all`; omitted resolves to `all`), a neutral `permissions` map — the seven keys
`file_read`, `search`, `file_write`, `shell`, `subagent`, `web`, `question`, each `allow`,
`ask`, or `deny` — and a `system_prompt`. Definitions are validated at startup against the
engine-owned meta-schema `src/schemas/agent.schema.yaml` (descriptor id must equal the
filename stem); stages reference them through the optional `agent` field, and validation
verifies every reference resolves with permissions compatible with the bound stage kind
contract. Each descriptor may also declare an optional free-form `model_override`
(non-empty when present, deliberately not enum-checked): the registry exposes
`effectiveModel = model_override ?? model`, deployment renders the effective model into the
frontmatter while the source `model` keeps the team recommendation, and CLI data surfaces
both values.

### The four kinds (DEC-006)

- **authoring** — generic flag loop (`--change`, `--request`, `--next-ids`, `--update-artifact`,
  `--append-delta`, `--complete-step`, `--finalize`, `--confirm-semantic`, `--describe`,
  `--describe-step`, `--help`) driving the step machine from `steps.yaml` completion predicates.
  Every authoring stage declares the same six-step tour (`needs_input`, `init`, `authoring`,
  `ready`, `complete`, `recovery`), detected from artifact state; discovery/scenarios/assumptions
  guidance is folded into the `authoring` step, and `--finalize --confirm-semantic` evaluates
  gate, mechanical validation, and semantic confirmation in one call (legacy `--complete-step`
  step names are still accepted). Requirements artifacts carry ONE merged `acceptance_criteria`
  list (id, Given-When-Then statement, category happy/edge/negative/boundary, parent_id) —
  there is no separate scenarios list and no promotion pass.
- **review** — resolves its `reviews` target, checks the review gate, runs the unified
  validation, appends rounds to the review file (append-only), and applies
  `--accept`/`--reject`/`--dry-run`.
- **tasks** — task state machine over `plan.yaml` for the implementation stage.
- **aggregator** — collects delta arrays from delta-producing stages for knowledge-extraction.

### The requires DAG and the acceptance gate (DEC-007, DEC-008)

Pipeline order is a topological sort of the requires graph with an alphabetical stage-id
tie-break; there is no sequence field. Migrated edges (DM-008):

```
requirements
  └─ requirements-review (reviews requirements)
       └─ design
            └─ design-review (reviews design)
                 └─ planning  (requires requirements-review and design-review)
                      └─ planning-review (reviews planning)
                           └─ implementation
                                └─ implementation-review (reviews implementation)
                                     └─ knowledge-extraction
```

A stage is runnable only when every required stage's tracked artifact has status `accepted`
(where the tracked artifact of a review stage is the artifact of the stage it reviews). A
review stage is runnable when its tracked artifact is `ready-for-review` or `accepted`. Gate
failures produce a blocked envelope naming each unsatisfied requirement and its current
status. A requires cycle or a missing reference is a hard startup error.

### Validation (FLW-004)

Layer order is preserved: YAML parse → JSON Schema (`schema.yaml`) → named structural checks
(`structural-checks.yaml`) → semantic advisory checklist (`semantic-checks.yaml`) → review
gate. One `validateArtifact(stageId, artifact, changeRoot)` serves authoring `--finalize`,
the review stages, and `bin/lint-artifact.ts`, so internal finalization and external review
produce identical findings.

### The capped check catalog (DEC-003, DEC-004)

Structural validation runs through a fixed catalog of eleven named generic checks in
`src/scripts/lib/checks/`:

`unique-ids`, `ref-exists`, `referenced-by`, `duplicate-refs`, `given-when-then`,
`forbidden-words`, `sentence-count`, `required-note-for-status`, `all-tasks-terminal`,
`dependency-acyclic`, `dependency-order`.

Stages declare checks with parameters in their `structural-checks.yaml`. Adding or changing a
check is a design-review event — this catalog is the single extension path for structural
validation logic.

---

## 6. Where to Find Details

Do not memorize file paths or internal APIs. Discover them:

| Need | Where to look |
|---|---|
| Stage descriptors & topology (requires/reviews) | `src/stages/<stage-id>/stage.yaml` |
| Per-stage structural checks | `src/stages/<stage-id>/structural-checks.yaml` |
| Per-stage semantic checks | `src/stages/<stage-id>/semantic-checks.yaml` |
| Per-stage schemas | `src/stages/<stage-id>/schema.yaml` |
| Per-stage templates | `src/stages/<stage-id>/template.yaml` |
| Per-stage step definitions | `src/stages/<stage-id>/steps.yaml` |
| Stage meta-schema | `src/schemas/stage.schema.yaml` |
| Stage registry (discovery) | `src/scripts/lib/stage-registry.ts` |
| Requires graph & acceptance gate | `src/scripts/lib/requires-graph.ts` |
| Generic check library (capped catalog) | `src/scripts/lib/checks/index.ts` |
| Unified validation orchestrator | `src/scripts/lib/validate.ts` |
| Kind interpreters | `src/scripts/lib/kinds/` |
| Steps loader & predicates | `src/scripts/lib/steps-loader.ts` |
| Agent definitions | `src/agents/` (one `<agent-id>.yaml` per agent, discovered by scan) |
| Agent meta-schema | `src/schemas/agent.schema.yaml` |
| Agent registry (discovery) | `src/scripts/lib/agent-registry.ts` |
| Kind permission contracts & compatibility | `src/scripts/lib/agent-permissions.ts` |
| Prompt purity markers | `src/scripts/lib/agent-prompt-marker.ts` |
| Platform renderers | `src/scripts/lib/deploy/platforms/` |
| Error codes & messages | `src/policies/errors.yaml` (the only central policy) |
| Skill generation source | `src/scripts/workflows/skill-manifest.ts` (single `skillManifest`; step definitions load from stage folders) |
| Deployment logic | `bin/deploy-to-agent.ts` |
| Agent audit skill (dev-only) | `src/skills/agent-audit/SKILL.md` |

When in doubt, run `npm run validate` and read the failing output.

---

## 7. Validation Layers (Order of Execution)

```
YAML parse → JSON Schema (stage schema.yaml) → Named structural checks (structural-checks.yaml)
→ Semantic advisory (semantic-checks.yaml) → Review gate
```

Schemas validate structure. Named checks validate meaning, traceability, and wording. Both
must pass.

---

## 8. Quick Reference Commands

```bash
npm run validate          # fast gate: schemas + policies + templates + typecheck + unit tests
npm run check:all         # full coverage: validate + unit + e2e tests + deploy smoke
npm run test:unit         # unit tests only
npm run test:e2e          # end-to-end tests only
npm run deploy:smoke      # bundled deploy + CLI smoke test
```

The `validate:schemas`, `validate:policies`, and `validate:templates` script entry points are
unchanged because the bins keep their paths; `bin/validate-policies.ts` validates
`errors.yaml` and the stage folders (descriptors, structural-checks declarations, steps.yaml,
schema.yaml) plus the agent layer (meta-schema, prompt purity markers, stage-reference
resolution, permission compatibility), and `bin/validate-templates.ts` validates the
stage-folder templates and the skill frontmatter under `src/skills/` (name equals folder,
non-empty description).

---

## 9. When Changing Specific Areas

| Area changed | Extra action |
|---|---|
| Stage folders (`src/stages/`) | `npm run validate:policies` (descriptors, checks, steps) + `npm run validate:templates` |
| Stage meta-schema (`src/schemas/stage.schema.yaml`) | `npm run validate:schemas` |
| Check catalog (`src/scripts/lib/checks/`) | Update `src/policies/errors.yaml` if new error codes are added and add a unit test; adding a check is a design-review event |
| Cross-file / lint checks | `npm run test:unit` + lint a real artifact with `bin/lint-artifact.ts` |
| Workflows / CLI behavior | Run the affected workflow with `--help` and a test change |
| Skills / deployment | `npm run deploy:smoke` and verify generated skills |
| Agent definitions (`src/agents/`) | `npm run validate:policies` (agent meta-schema, model-field cross-checks, prompt markers, reference resolution, permission compatibility) |
| Deploy platforms (`src/scripts/lib/deploy/platforms/`) | `npm run deploy:smoke` and verify the rendered agents |
| Agent audit skill (`src/skills/agent-audit/`) | `npm run validate:templates`; confirm `npm run deploy:smoke` still ships exactly two skills (the audit is dev-only, never deployed) |

If a new check type, error code, or ID prefix is added, update the corresponding catalog in
`src/policies/` (or the stage folder) and add a test.

---

## 10. Repository Utilities

| Utility | Purpose |
|---|---|
| `generate_context.js` | Compiles repo source into `llm_context.txt` (gitignored) for use as LLM context. Uses `.contextignore` or falls back to `.gitignore`. |
| `src/agents/` | Neutral agent definitions — one `<agent-id>.yaml` per agent (six shipped), discovered by directory scan, validated by `src/schemas/agent.schema.yaml`, and referenced optionally from `stage.yaml`. Details are in `codemap.md`. |
| `src/skills/agent-audit/` | Development-only agent audit skill — refreshes the model catalog enum from the live opencode endpoint, reassigns agent models with web-grounded justification (never touching an existing `model_override`), realigns parameters and permissions with stage purpose, and dedupes/adds/removes agents with `stage.yaml` rebinding. Invoked manually by the maintainer; never deployed. Details are in `src/skills/agent-audit/SKILL.md`. |
| `src/skills/improvement-review/` | Development-only improvement-review skill — re-runs the six-step SDLC improvement review against live dogfooding evidence: instruments sessions, measures artifacts/envelopes/fast-gate duration with four bundled deterministic TypeScript helper scripts under `scripts/` (the first dev-only skill to bundle scripts), mines caller-supplied transcripts, classifies gates, inventories unused surface, and writes `docs/ideas/` proposals with a governance test. A pure advisor: it reads the goals canon (`docs/current/capabilities.md`, `## SDLC Goals`) and the baselines (`docs/current/operations.md`, `## Baselines`) read-only and writes only `docs/ideas/` proposals. Invoked manually by the maintainer; never deployed. Details are in `src/skills/improvement-review/SKILL.md`. |
| `.opencode/` | Deployed agent runtime — created by `npm run deploy:smoke` / `bin/deploy-to-agent.ts --dest .opencode`. Gitignored (see `.gitignore`, `.contextignore`). Contains exactly two self-contained skills: `.opencode/skills/agentic-sdlc/` (SKILL.md + bundled `scripts/sdlc.js` + `stages/` + `schemas/`/`policies/`) and `.opencode/skills/knowledge-init/` (SKILL.md + `manifest.json`), plus `.opencode/agents/` (one rendered `<agent-id>.md` per source definition). **This is a build artifact, not source** — never edit it directly, never read it to understand "how the toolkit works," and never confuse it with this repository's own development code under `src/`, `bin/`, `test/`. |

---

## 11. Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`. `src/agents/`
has no sub-codemap; its responsibilities are covered in the root `codemap.md` Directory Map.
