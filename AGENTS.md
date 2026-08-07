# AGENTS.md — Mandatory Rules for AI Coding Agents

## 1. The One Rule

Before declaring any change complete:

```bash
npm run validate
```

If it fails, the work is not done. No exceptions.

For full confidence (includes deployment smoke test):

```bash
npm run check:all
```

---

## 2. Invariants (Never Break These)

1. Contracts are the source of truth for validation.
2. The CLI owns lifecycle state transitions.
3. Review history is append-only; rounds are never deleted.
4. Living docs (`docs/current/`) are updated only through knowledge extraction.
5. Authoring stages produce delta entries; they never edit `docs/current/` directly.
6. Implementation state lives in `plan.yaml`.
7. The toolkit is agent-agnostic — no hardcoded agent paths.
8. The CLI envelope shape is frozen.

---

## 3. Terminology

| Term | Meaning |
|---|---|
| stage | Main workflow (requirements, design, planning, implementation, knowledge-extraction) |
| gate | Review checkpoint |
| step | Internal step inside a workflow |
| state | CLI response state (ok, in_progress, blocked, complete) |
| status | Artifact lifecycle status (draft, ready-for-review, accepted, rejected, blocked) |

Do not conflate these.

---

## 4. Definition of Done

A change is complete when:

- `npm run validate` passes.
- No invariant from §3 is violated.
- No new top-level CLI envelope fields were introduced.
- No hardcoded agent-specific paths were added.
- If deployment-related files changed: `npm run deploy:smoke` passes.
- If behavior changed: relevant docs in this file or referenced docs are updated.

---

## 5. Where to Find Details

Do not memorize file paths or internal APIs. Discover them:

| Need | Where to look |
|---|---|
| Contract structure & check types | `src/schemas/contract-meta.schema.yaml` |
| Artifact shapes | `src/schemas/*.schema.yaml` |
| Pipeline topology & review targets | `src/policies/pipeline.yaml`, `src/policies/review-targets.yaml` |
| Lifecycle transitions | `src/policies/lifecycle.yaml` |
| Error codes & messages | `src/policies/errors.yaml` |
| ID conventions & patterns | `src/policies/ids.yaml` |
| Discovery policy | `src/policies/requirements-policy.yaml` |
| Skill generation source | `src/scripts/workflows/skill-manifest.js` |
| Deployment logic | `bin/deploy-to-agent.js` |
| Implementation plans | `the-plan.md` (this repository's planning doc) |

When in doubt, run `npm run validate` and read the failing output.

---

## 6. Validation Layers (Order of Execution)

```
YAML parse → JSON Schema (shape) → Contract checks (relations) → Semantic (LLM) → Review gate → Knowledge extraction
```

Schemas validate structure. Contracts validate meaning and traceability. Both must pass.

---

## 7. Quick Reference Commands

```bash
npm run validate          # schemas + policies + contracts + templates + tests
npm run check:all         # validate + all test layers + deploy smoke
npm run test:unit         # unit tests only
npm run test:e2e          # end-to-end tests only
npm run test:contracts    # fixture-driven contract tests
npm run deploy:smoke      # bundled deploy + CLI smoke test
```

---

## 8. When Changing Specific Areas

| Area changed | Extra action |
|---|---|
| Contracts (`src/contracts/`) | `npm run validate:contracts` + lint a real artifact |
| Schemas (`src/schemas/`) | `npm run validate:schemas` |
| Policies (`src/policies/`) | `npm run validate:policies` |
| Templates (`src/templates/`) | `npm run validate:templates` |
| Workflows / CLI behavior | Run the affected workflow with `--help` and a test change dir |
| Skills / deployment | `npm run deploy:smoke` and verify generated skills |

If a new check type, error code, or ID prefix is added, update the corresponding catalog in `src/policies/` and add a test.