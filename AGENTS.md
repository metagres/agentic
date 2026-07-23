This file contains mandatory rules for AI coding agents working on this project.

## 1. Primary rule

Before finishing any change, run:

```bash
npm run validate
```

If `npm run validate` does not exist, run:

```bash
npm test
```

Do not declare work complete if validation or tests fail.

---

## 2. Naming conventions

Use these terms consistently.

| Term | Meaning | Examples |
|---|---|---|
| stage | Main SDLC workflow | `requirements`, `design`, `planning`, `implementation`, `knowledge-extraction` |
| gate | Review checkpoint | `review` |
| step | Internal step inside a workflow | `discovery`, `drafting`, `validation`, `delta`, `recovery`, `complete` |
| state | Runtime state of a CLI response | `ok`, `in_progress`, `blocked`, `complete` |
| status | Artifact lifecycle status | `draft`, `ready-for-review`, `accepted`, `rejected`, `blocked` |
| implementation status | Implementation lifecycle | `pending`, `in_progress`, `ready-for-review`, `accepted`, `rejected` |

Do not use `phase` for both SDLC stages and internal steps.

Use:

```text
stage: requirements
step: discovery
```

not:

```text
phase: requirements
phase: discovery
```

---

## 3. Artifact and file naming

Main artifacts:

```text
requirements.yaml
design.yaml
plan.yaml
docs-delta.yaml
```

Review files:

```text
requirements-review.yaml
design-review.yaml
plan-review.yaml
implementation-review.yaml
```

ID conventions:

```text
FR-NNN
NFR-NNN
AC-NNN
DL-NNN
CMP-NNN
DM-NNN
API-NNN
DEC-NNN
TASK-NNN
DD-...
```

---

## 4. CLI output envelope

All CLI output must use only these top-level fields:

```json
{
  "workflow": "...",
  "step": "...",
  "state": "...",
  "instructions": "...",
  "data": {},
  "errors": [],
  "warnings": []
}
```

Do not add new top-level fields unless explicitly approved.

Put domain-specific values inside `data`.

---

## 5. Contract rules

Contracts live in:

```text
src/contracts/
```

Contracts are the source of truth for validation.

When writing or changing contracts:

- Use valid YAML.
- Use single quotes for regex patterns.
- Do not use unsupported JSONPath-like filters.
- Every mechanical check must have a matching handler.
- Every check must have `id`, `severity`, `category`, `message`, and `fix`.
- Mechanical checks must declare required params.
- Semantic checks must declare `severity` and `category`.

Good regex example:

```yaml
pattern: '^FR-\d{3}$'
```

Bad regex example:

```yaml
pattern: "^FR-\d{3}$"
```

---

## 6. Testing commands

Full validation:

```bash
npm run validate
```

This should run at least:

```bash
npm run validate:contracts
npm run validate:templates
npm test
```

If those scripts do not exist, use:

```bash
npm test
```

---

## 7. What to test when something changes

### If you change a contract

Changed file examples:

```text
src/contracts/requirements-contract.yaml
src/contracts/design-contract.yaml
src/contracts/plan-contract.yaml
src/contracts/implementation-contract.yaml
```

Run:

```bash
npm run validate:contracts
npm test
```

Then lint a relevant artifact:

```bash
node bin/lint-artifact.mjs \
  --contract requirements \
  --artifact docs/changes/<change-dir>/requirements.yaml
```

Or:

```bash
node bin/lint-artifact.mjs \
  --contract plan \
  --artifact docs/changes/<change-dir>/plan.yaml \
  --gate review
```

If the contract rule is important, add a fixture test:

```text
test/fixtures/contracts/<contract>/valid.yaml
test/fixtures/contracts/<contract>/invalid.yaml
```

---

### If you change a template

Changed file examples:

```text
src/templates/requirements.yaml
src/templates/design.yaml
src/templates/plan.yaml
src/templates/docs-current-index.md
```

Run:

```bash
npm run validate:templates
npm test
```

Templates must remain valid YAML and keep required top-level keys.

Templates are skeletons. They are not required to pass full contract validation as-is.

---

### If you change `contract-checks.mjs`

Changed file:

```text
src/scripts/lib/contract-checks.mjs
```

Run:

```bash
npm run validate:contracts
npm test
```

Also lint at least one real artifact:

```bash
node bin/lint-artifact.mjs \
  --contract requirements \
  --artifact docs/changes/<change-dir>/requirements.yaml
```

If you add a new check type:

1. Add the handler.
2. Add required parameter validation.
3. Add a contract example or fixture.
4. Add a test.
5. Run:

```bash
npm run validate
```

---

### If you change a workflow

Changed files examples:

```text
src/scripts/workflows/requirements.mjs
src/scripts/workflows/design.mjs
src/scripts/workflows/planning.mjs
src/scripts/workflows/implementation.mjs
src/scripts/workflows/review.mjs
src/scripts/workflows/knowledge-extraction.mjs
src/scripts/workflows/status.mjs
src/scripts/workflows/index.mjs
```

Run:

```bash
npm test
```

Also manually check the affected workflow:

```bash
node src/scripts/sdlc.mjs <workflow> --help
```

For pipeline behavior, check:

```bash
node src/scripts/sdlc.mjs status --dir <change-dir>
```

Preserve the minimal CLI envelope.

---

### If you change skills

Skills are generated from:

```text
src/scripts/workflows/skill-manifest.mjs
```

Do not edit generated `SKILL.md` files in deployed agent directories.

After changing skill content, test deployment:

```bash
node bin/deploy-to-agent.mjs \
  --dest /tmp/test-agent-root \
  --project-root /tmp/test-project \
  --bundle \
  --clean
```

Check that generated skills exist:

```text
/tmp/test-agent-root/skills/
```

Do not hardcode agent-specific paths such as:

```text
.opencode
.cursor
.agent
```

---

### If you change deployment

Changed files examples:

```text
bin/deploy-to-agent.mjs
bin/build-runtime.mjs
src/scripts/workflows/skill-manifest.mjs
```

Run:

```bash
npm test
```

Then test deployment:

```bash
node bin/deploy-to-agent.mjs \
  --dest /tmp/test-agent-root \
  --project-root /tmp/test-project \
  --bundle \
  --clean
```

The deployed runtime must work without hardcoding the agent root.

---

## 8. Required invariants

Do not break these.

1. Contracts are the source of truth for validation.
2. The CLI owns lifecycle state.
3. Review history must be preserved.
4. Living docs under `docs/current/` are updated through knowledge extraction.
5. Authoring stages produce delta entries; they do not directly edit `docs/current/`.
6. Implementation state lives in `plan.yaml`.
7. The toolkit remains agent-agnostic.
8. The CLI envelope remains minimal.

---

## 9. Definition of done

A change is complete only when all of these are true:

```text
The change is implemented.
The relevant tests exist and pass.
npm run validate passes.
npm test passes.
Contracts remain valid.
Templates remain valid.
No hardcoded agent paths were introduced.
The CLI envelope was not changed without approval.
Generated skills were changed only via source manifest, if applicable.
Deployment still works, if deployment-related files changed.
Documentation or instructions were updated if behavior changed.
```

Minimum final check:

```bash
npm run validate
```

If deployment-related files changed, also run:

```bash
node bin/deploy-to-agent.mjs \
  --dest /tmp/test-agent-root \
  --project-root /tmp/test-project \
  --bundle \
  --clean
```
---

## 10. Hardening extensions

The toolkit now includes schema and policy layers.

### Schemas

Schemas live in:

```text
src/schemas/
```

Validate schemas with:

```bash
npm run validate:schemas
```

Schema validation checks artifact shape. Contract validation still checks relationships, traceability, and domain rules.

### Policies

Policies live in:

```text
src/policies/
```

Current policies:

```text
pipeline.yaml
review-targets.yaml
lifecycle.yaml
requirements-policy.yaml
semantic-policy.yaml
errors.yaml
ids.yaml
```

Validate policies with:

```bash
npm run validate:policies
```

### New utilities

Check project configuration:

```bash
node src/scripts/sdlc.mjs doctor
node src/scripts/sdlc.mjs doctor --strict
```

Bootstrap living docs index:

```bash
node src/scripts/sdlc.mjs docs-init
node src/scripts/sdlc.mjs docs-init --force
```

### Review behavior

Review rounds are recorded by default.

Use:

```bash
sdlc review --target requirements --dir <change-dir> --dry-run
```

for a non-persisted review inspection.

### Definition of done update

For schema, policy, contract, or workflow changes, run:

```bash
npm run validate
```

For broader validation, run:

```bash
npm run check:all
```

## 11. Additional hardening notes

### Strict mode

Several commands support `--strict`:

```bash
node src/scripts/sdlc.mjs planning --dir <change-dir> --strict
node src/scripts/sdlc.mjs review --target requirements --dir <change-dir> --strict
node src/scripts/sdlc.mjs knowledge-extraction --dir <change-dir> --strict
node src/scripts/sdlc.mjs doctor --strict
```

In strict mode, selected warnings become blocking errors, including:

- missing `docs/current/index.md`
- previous stage not ready
- implementation not accepted
- incomplete semantic validation at gate-like steps
- advisory review findings in review strict mode

### Schema and policy conformance

Schemas validate structural shape. Contracts remain the source of truth for traceability and domain rules.

Run layered validation with:

```bash
npm run validate:schemas
npm run validate:policies
npm run validate:contracts
npm run validate:templates
npm run test:unit
npm run test:contracts
npm run test:e2e
npm run test:all
npm run check:all
```

### Error and ID catalogs

Error messages and fixes are cataloged in:

```text
src/policies/errors.yaml
```

ID conventions are cataloged in:

```text
src/policies/ids.yaml
```

When adding new error codes or ID prefixes, update these catalogs and relevant tests.
