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

1. JSON Schemas are the structural source of truth; cross-file + lint checks enforce traceability.
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
- No invariant from §2 is violated.
- No new top-level CLI envelope fields were introduced.
- No hardcoded agent-specific paths were added.
- If deployment-related files changed: `npm run deploy:smoke` passes.
- If behavior changed: relevant docs in this file or referenced docs are updated.

---

## 5. Where to Find Details

Do not memorize file paths or internal APIs. Discover them:

| Need | Where to look |
|---|---|
| Artifact shapes (structure) | `src/schemas/*.schema.yaml` |
| Cross-file + lint checks | `src/scripts/lib/validators.ts`, `src/scripts/lib/lint-checks.ts` |
| Pipeline topology & review targets | `src/policies/pipeline.yaml` |
| Stage config loader | `src/scripts/lib/pipeline.ts` |
| Error codes & messages | `src/policies/errors.yaml` |
| ID conventions & patterns | `src/policies/ids.yaml` |
| Discovery policy | `src/policies/requirements-policy.yaml` |
| Semantic (advisory) checks | `src/policies/semantic-checks.yaml` |
| Skill generation source | `src/scripts/workflows/skill-manifest.ts` |
| Deployment logic | `bin/deploy-to-agent.ts` |
| Implementation plans | `the-plan.md` (this repository's planning doc) |

When in doubt, run `npm run validate` and read the failing output.

---

## 6. Validation Layers (Order of Execution)

```
YAML parse → JSON Schema (shape) → Cross-file + lint checks (traceability/wording) → Semantic (advisory, LLM) → Review gate → Knowledge extraction
```

Schemas validate structure. Cross-file + lint checks validate meaning, traceability, and wording. Both must pass.

---

## 7. Quick Reference Commands

```bash
npm run validate          # schemas + policies + templates + typecheck + tests
npm run check:all         # validate + all test layers + deploy smoke
npm run test:unit         # unit tests only
npm run test:e2e          # end-to-end tests only
npm run deploy:smoke      # bundled deploy + CLI smoke test
```

---

## 8. When Changing Specific Areas

| Area changed | Extra action |
|---|---|
| Schemas (`src/schemas/`) | `npm run validate:schemas` |
| Policies (`src/policies/`) | `npm run validate:policies` |
| Templates (`src/templates/`) | `npm run validate:templates` |
| Cross-file / lint checks | `npm run test:unit` + lint a real artifact with `bin/lint-artifact.ts` |
| Workflows / CLI behavior | Run the affected workflow with `--help` and a test change dir |
| Skills / deployment | `npm run deploy:smoke` and verify generated skills |

If a new check type, error code, or ID prefix is added, update the corresponding catalog in `src/policies/` and add a test.

---

## 9. Repository Utilities

| Utility | Purpose |
|---|---|
| `generate_context.js` | Compiles repo source into `llm_context.txt` (gitignored) for use as LLM context. Uses `.contextignore` or falls back to `.gitignore`. |
| `.opencode/sdlc/` + `.opencode/skills/` | Deploy targets, regenerated via `npm run deploy:smoke`. Not source — do not edit directly. |
