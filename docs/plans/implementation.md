---
document_type: implementation
project_slug: agentic-sdlc
version: 0.9.2
status: implementation-ready draft
created: 2026-09-15
updated: 2026-09-21
subordinate_to: specification.md
---

# Implementation Design & Plan — Agentic SDLC Toolkit (v0.9.2)

## 1. Relationship to specification

This document defines how the current implementation chooses to satisfy `specification.md`.

It is deliberately mutable. Implementation changes MAY revise this document without changing the specification. However, implementation changes MUST NOT alter normative behavior or invariants without a corresponding specification amendment.

This document is subordinate to `specification.md`. Where this document and `specification.md` disagree, `specification.md` is authoritative.

---

## 2. Deployed package layout

The deployed Agentic SDLC package belongs to the OpenCode configuration namespace.

```text
.opencode/
  agents/
    coordinator.md
    author.md
    stage-reviewer.md
    archiver.md

  commands/
    sdlc-next.md

  skills/
    qna/
      SKILL.md
    work-item-scaffold/
      SKILL.md
      references/init-template.md
      references/workflow-template.json
    archive-work-item/
      SKILL.md
      references/archive-template.md

  tools/
    sdlc.ts                         # OpenCode discovery/adapter entry point
    sdlc/
      manifest.json
      bin/
        sdlc-cli.js                 # deployed deterministic CLI
      lib/
      config.yaml
      config/
        stages.yaml
        workflows.yaml
        types.yaml
        checks/
          <stage-review-checklists>.yaml
        schemas/
          <artifact schemas>.json
        templates/
          <stage templates>.md
```

The OpenCode-discoverable adapter is `.opencode/tools/sdlc.ts`. Its adjacent `.opencode/tools/sdlc/` directory contains the deterministic CLI, runtime modules, configuration, schemas, checks, and templates.

The adapter is thin: it delegates to the CLI packaged alongside it. Resolve the CLI relative to the adapter's installation location; resolve work-item data relative to the active target repository. These locations are distinct.

Nested files in `tools/sdlc/` are package resources, not separately discovered OpenCode tools.

---

## 3. Canonical source repository layout

The toolkit's canonical source repository is distinct from deployed OpenCode files.

```text
src/
  cli/
  lib/
  config/
    stages.yaml
    workflows.yaml
    types.yaml
    checks/
    schemas/
    templates/
  agents/
  skills/
  commands/
    sdlc-next.md
  adapter/
    sdlc.ts
tests/
  fixtures/
  unit/
  integration/
  parity/
scripts/
  build.ts
  install.ts
dist/
  # generated deployment payload
```

Development changes are made in canonical source and tests, then built/installed into a fixture or target installation.

Deployed files are generated. They are not the source of truth.

---

## 4. Build and install implementation

The canonical source defines:

```text
canonical source -> build -> deployment fixture -> target installation
```

Build:

```text
npm run build
```

MUST:

1. compile TypeScript to JavaScript;
2. copy configuration, checks, schemas, templates, agents, commands, and skills into `dist/`;
3. produce `dist/tools/sdlc/bin/sdlc-cli.js`;
4. produce `dist/tools/sdlc.ts`;
5. write a manifest containing toolkit version, supported OpenCode version range, config schema, and build hash.

Install is executed by the already-built CLI from the canonical repository or a packaged release. The bootstrap invocation MAY therefore be `node dist/tools/sdlc/bin/sdlc-cli.js install ...`; after installation, `sdlc install ...` is the normal form.

```text
sdlc install --target <repo> --scope project|global
```

MUST:

1. verify Node and the supported OpenCode version range;
2. copy the generated deployment payload into the target `.opencode/` tree;
3. refuse to overwrite a deployed package unless `--force` is supplied;
4. record installation scope and version in `.opencode/tools/sdlc/manifest.json`.

Source-to-deployment parity tests MUST verify that every canonical resource has a deployed counterpart with matching content hash.

---

## 5. Installation scope and configuration precedence implementation

Configuration resolution follows OpenCode's own tool resolution. Whichever installation OpenCode resolves determines the configuration:

* if the project-local `.opencode/tools/sdlc.ts` is resolved, the project-local `.opencode/tools/sdlc/config.yaml` is used;
* otherwise the global installation's config is used;
* built-in defaults apply only where the resolved config is silent.

Global and project configuration are never merged. They do not fall back to each other.

`sdlc doctor` reports a shadowed installation if one exists — for example, a global installation present when the project-local installation is active — as informational output only. Shadowing does not change resolution.

Work-item lifecycle data remains project-owned under `docs/work-items/`.

---

## 6. OpenCode integration implementation

### 6.1 Agents and subagents

OpenCode supports primary agents and subagents. Primary agents can invoke subagents through the Task mechanism, and task permissions can restrict which subagents are available to a given agent. Custom agents can define their own models, prompts, and permissions.

Therefore:

* `coordinator` is a primary agent.
* `author`, `stage-reviewer`, and `archiver` are subagents.
* The coordinator's subagent permission is limited to those agents.
* The workflow engine chooses *which stage* to run; the registry chooses *which actor* handles that stage.

No custom SDK-based subagent orchestration is required for v1.

### 6.2 Custom commands

OpenCode supports project-local custom commands that can select an agent, model, and whether execution happens in a child session.

A `/sdlc-next` command MAY be provided as a convenience entry point, but it is not load-bearing. The coordinator can invoke stage subagents through the native Task mechanism.

An optional:

```text
.opencode/commands/sdlc-next.md
```

may provide:

```text
Run the next stage for the current work-item.

First obtain the work-item state with sdlc_get_work_item_state.
If status is not "active", stop and report the state and reason.
Otherwise delegate the stage named by state.stage according to the stage registry.
Do not perform specialist work yourself.
```

OpenCode custom commands can select an agent and can execute in a child session.

This command is convenience only. The workflow does not depend on it.

### 6.3 Custom tools

OpenCode supports project-local TypeScript/JavaScript custom tools under `.opencode/tools/`. Multiple tools can be exported from one file, each receiving its own tool name.

The toolkit therefore provides thin OpenCode adapters such as:

```text
sdlc_scaffold
sdlc_get_work_item_state
sdlc_validate
sdlc_write
sdlc_gate
sdlc_raise_upstream
sdlc_resolve_upstream
sdlc_archive
sdlc_list
sdlc_amend_workflow
```

`sdlc_approve` and `sdlc_abandon` are not exported to OpenCode agents in v1. Both are human terminal operations through the CLI.

Each adapter delegates to the deterministic `sdlc` CLI.

### 6.4 Direct agent writes

Agents MAY edit code when required by their stage. Agents MUST NOT directly write work-item machine artifacts. The normal path for machine artifacts is `sdlc_write`.

This is enforced by:

1. OpenCode permission hardening for normal operation,
2. deterministic validator detection of out-of-band changes.

It is not an absolute security boundary. If an implementation agent has shell access, it can potentially modify files. The validator MUST detect schema, revision, and `based_on` inconsistencies caused by out-of-band writes.

### 6.5 Model and temperature configuration

OpenCode supports per-agent model and temperature configuration.

The default remains one `author` agent with stage-specific prompt templates. Different temperatures are not required merely because stages differ.

If evidence later shows that a particular stage needs a different model or temperature, the stage registry may select a different agent configuration without changing the workflow engine.

### 6.6 Runtime boundary

The deterministic toolkit CLI remains Node/TypeScript.

OpenCode's `.opencode` adapter layer is TypeScript/JavaScript because that is OpenCode's native custom-tool mechanism. The adapter is not a second workflow runtime; it is an integration layer that invokes the Node CLI.

Runtime invariant:

> **One deterministic toolkit runtime: Node. OpenCode-native adapter code may use OpenCode's supported TypeScript/JavaScript tool mechanism.**

### 6.7 Permission hardening

OpenCode permissions restrict tools and subagents by role.

The toolkit requires:

* agents cannot use `sdlc_approve` or `sdlc_abandon`;
* reviewer agents cannot edit project files;
* stage agents cannot invoke arbitrary subagents;
* direct machine-artifact writes use `sdlc_write`;
* `sdlc_amend_workflow --stage` is callable by the coordinator only, and only when the current stage is the configured workflow-authoring stage and the workflow is not frozen;
* after freeze, workflow amendment requires the human terminal path;
* terminal execution is performed by the coordinator through the deterministic CLI; it is not delegated to a separate script agent.

These are access controls, not cryptographic identity guarantees.

---

## 7. Stage registry, workflows, and examples

### 7.1 Stage registry example

The registry defines stage semantics, not workflows.

Example:

```yaml
stages:

  define:
    actor: author
    template: define
    artifact:
      file: specification.json
      schema: specification
      inputs: []
    workflow_authoring: true
    completion:
      mode: artifact

  define-review:
    actor: stage-reviewer
    artifact:
      file: specification-review.json
      schema: review
    review:
      target: define
      checklist: checks/specification-review.yaml
      rework: define
      max_rounds: review.max_rounds
    completion:
      mode: review_gate

  design:
    actor: author
    template: design
    artifact:
      file: design.json
      schema: design
      inputs:
        - define
    completion:
      mode: artifact

  design-review:
    actor: stage-reviewer
    artifact:
      file: design-review.json
      schema: review
    review:
      target: design
      checklist: checks/design-review.yaml
      rework: design
      max_rounds: review.max_rounds
    completion:
      mode: review_gate

  plan:
    actor: author
    template: plan
    artifact:
      file: plan.json
      schema: plan
      inputs:
        - design
    completion:
      mode: artifact

  plan-review:
    actor: stage-reviewer
    artifact:
      file: plan-review.json
      schema: review
    review:
      target: plan
      checklist: checks/plan-review.yaml
      rework: plan
      max_rounds: review.max_rounds
    completion:
      mode: review_gate

  build:
    actor: author
    template: implementation
    artifact:
      file: implementation-log.json
      schema: implementation-log
      inputs:
        - plan
    checkpoint:
      before: true
      type: human
    completion:
      mode: artifact

  build-review:
    actor: stage-reviewer
    artifact:
      file: build-review.json
      schema: review
    review:
      target: build
      checklist: checks/build-review.yaml
      rework: build
      max_rounds: review.max_rounds
    completion:
      mode: review_gate

  release:
    actor: script
    terminal:
      command: archive
      completion_file: archive.md
    completion:
      mode: terminal
```

The names above are examples only.

A project can instead define:

```yaml
stages:

  specification:
    actor: author
    template: requirements
    artifact:
      file: requirements.json
      schema: specification
      inputs: []
    completion:
      mode: artifact
```

`deriveWorkItemState` treats both definitions identically.

### 7.2 Workflow templates example

Named workflow templates are optional.

If present:

```text
.opencode/tools/sdlc/config/workflows.yaml
```

may contain:

```yaml
workflows:

  standard:
    stages:
      - define
      - define-review
      - design
      - design-review
      - plan
      - plan-review
      - build
      - build-review
      - release
    freeze_after: define

  architectural:
    stages:
      - define
      - define-review
      - design
      - design-review
      - plan
      - plan-review
      - build
      - build-review
      - release
    freeze_after: define

  investigation:
    stages:
      - define
      - define-review
      - investigate
      - release
    freeze_after: define
```

The selected workflow is copied into `workflow.json`.

After scaffold, `workflow.json` is authoritative. Changing `workflows.yaml` does not silently change an existing work-item.

A work-item may also use a custom stage array not present in `workflows.yaml`.

### 7.3 Appendix A — Generic workflow example (non-normative)

Illustrative only. The normative stage-semantics vocabulary is §8.3 of `specification.md`; the normative registry shape is the schema in `config/schemas/`.

The following workflow is intentionally named without using `requirements`, `design`, `implementation`, or `archive`:

```yaml
stages:

  specification:
    actor: author
    template: specification
    artifact:
      file: specification.json
      schema: specification
      inputs: []
    workflow_authoring: true
    completion:
      mode: artifact

  specification-review:
    actor: stage-reviewer
    artifact:
      file: specification-review.json
      schema: review
    review:
      target: specification
      checklist: checks/specification-review.yaml
      rework: specification
      max_rounds: review.max_rounds
    completion:
      mode: review_gate

  build:
    actor: author
    template: build
    artifact:
      file: build-log.json
      schema: build-log
      inputs:
        - specification
    completion:
      mode: artifact

  verify:
    actor: stage-reviewer
    artifact:
      file: verification.json
      schema: review
    review:
      target: build
      checklist: checks/verification.yaml
      rework: build
      max_rounds: review.max_rounds
    completion:
      mode: review_gate

  release:
    actor: script
    terminal:
      command: archive
      completion_file: archive.md
    completion:
      mode: terminal
```

A work-item may contain:

```json
{
  "stages": [
    "specification",
    "specification-review",
    "build",
    "verify",
    "release"
  ],
  "freeze_after": "specification"
}
```

The state-derivation core needs no special knowledge of what "specification" means.

### 7.4 Appendix B — Hotfix workflow example (non-normative)

Illustrative only, as in Appendix A.

A hotfix can use a completely different shape:

```json
{
  "revision": 1,
  "status": "active",
  "type": "hotfix",
  "stages": [
    "incident-intake",
    "mitigation",
    "verification",
    "release"
  ],
  "freeze_after": "incident-intake",
  "stage_rationale": "Production incident requires mitigation before normal planning."
}
```

The stage registry defines the semantics:

```yaml
stages:

  incident-intake:
    actor: author
    template: incident-intake
    artifact:
      file: incident.json
      schema: incident
      inputs: []
    completion:
      mode: artifact

  mitigation:
    actor: author
    template: mitigation
    artifact:
      file: mitigation-log.json
      schema: mitigation
      inputs:
        - incident-intake
    checkpoint:
      before: true
      type: human
    completion:
      mode: artifact

  verification:
    actor: stage-reviewer
    artifact:
      file: verification.json
      schema: review
    review:
      target: mitigation
      checklist: checks/hotfix-verification.yaml
      rework: mitigation
      max_rounds: review.max_rounds
    completion:
      mode: review_gate

  release:
    actor: script
    terminal:
      command: archive
      completion_file: archive.md
    completion:
      mode: terminal
```

No hotfix-specific branch is required in `deriveWorkItemState`.

---

## 8. CLI implementation details

### 8.1 Source tree structure and module boundaries

The canonical source tree is organized under `src/`:

```text
src/
  cli/
  lib/
  config/
    stages.yaml
    workflows.yaml
    types.yaml
    checks/
    schemas/
    templates/
  agents/
  skills/
  commands/
    sdlc-next.md
  adapter/
    sdlc.ts
```

Module boundaries should keep the following separate:

* CLI command parsing and I/O
* deterministic workflow/state logic
* registry/config loading and validation
* artifact schema validation
* filesystem transaction and locking mechanics
* OpenCode adapter translation
* build/install packaging

The pure state core belongs in `src/lib/state/` and MUST NOT import filesystem, configuration, or model-call modules.

### 8.2 Algorithms

#### State derivation

`deriveWorkItemState` walks the workflow's stage IDs in order and evaluates each stage using only the registry semantics and explicit `DerivationInput`.

Unknown completion modes, missing registry entries, invalid references, or malformed workflow structures yield `invalid`.

The facade `getWorkItemState` resolves repository, work-item location, registry, artifacts, approvals, upstream issues, and policy snapshot, then delegates to the pure core for live work-items.

#### Review rounds

The CLI owns review artifact revision, round numbering, `reviewed_revision`, and `gate_cleared`.

One `sdlc_write` call for a review stage creates exactly one round.

The latest round is the round with the highest `round` number.

Empty findings clear the gate.

Observations from prior rounds remain visible but do not affect the gate.

### 8.3 Serialization approach

Work-item machine artifacts are JSON.

Work-item narrative artifacts are Markdown.

Registry, configuration, checklists, and schemas use YAML or JSON as declared by their location and loader.

There is no JSON↔YAML conversion layer.

Agents do not directly write machine artifacts.

### 8.4 Filesystem implementation

Single-file writes:

1. write to `path.tmp` in the same directory,
2. fsync,
3. rename over `path`,
4. fsync directory where supported.

Multi-file operations:

* `resolve-upstream`
* `archive`
* `abandon`
* `sdlc write` when it also freezes the workflow

MUST use a transaction journal.

Journal file:

```text
docs/work-items/<slug>/.sdlc-txn.json
```

Transaction steps:

1. acquire exclusive `.sdlc.lock`,
2. write journal with operation ID, intended writes, and backups,
3. apply operations,
4. mark journal `committed`,
5. remove journal and backups,
6. release lock.

On CLI startup, if a journal exists:

* if state is `prepared`, restore backups and remove journal,
* if state is `committed`, complete remaining operations and remove journal.

If recovery cannot be completed, the CLI exits with recovery required.

Concurrent mutating invocations MUST fail fast if the lock cannot be acquired.

`amend-workflow` uses the single-file atomic-write pattern.

### 8.5 Locking mechanism

Each work-item has a `.sdlc.lock` file.

Mutating commands acquire an exclusive lock before applying changes.

If the lock cannot be acquired, the CLI fails fast with a current-state conflict.

Repository-level mutation locking applies to individual work-item operations; it does not serialize unrelated work-items.

### 8.6 Transaction/journaling implementation

The transaction journal is `docs/work-items/<slug>/.sdlc-txn.json`.

It records:

* operation ID
* intended writes
* backups
* state: `prepared` or `committed`

Recovery behavior is as described in §8.4.

### 8.7 Idempotency and stale-operation behavior

`sdlc write` is not idempotent by default. Each successful write creates a new revision.

If the current stage changes between a read and a write, `sdlc write` exits with current-stage conflict.

`sdlc approve` is idempotent for the same fingerprint. Re-approving the same stage and fingerprint returns the existing approval artifact unchanged. `approved_at` records when the human approved that fingerprint and is not modified by re-approval. If the fingerprint has changed, the previous approval is stale and a fresh approval is required.

`sdlc abandon` is idempotent for the same work-item. Re-abandoning an already-abandoned work-item returns the existing `workflow.json` unchanged. Re-abandoning a `done` work-item exits with current-state conflict (exit 5).

---

## 9. Test fixture structure

```text
tests/
  fixtures/
  unit/
  integration/
  parity/
```

Parity tests MUST exercise:

* `getWorkItemState` and `deriveWorkItemState` against the same fixtures
* source-to-deployment resource parity by content hash
* adapter path resolution
* approval-path and abandonment-path smoke behavior
* large-repository performance

---

## 10. Build tooling and npm scripts

Scripts:

```text
scripts/
  build.ts
  install.ts
```

Build:

```text
npm run build
```

Install is executed by the already-built CLI from the canonical repository or a packaged release. The bootstrap invocation MAY therefore be `node dist/tools/sdlc/bin/sdlc-cli.js install ...`; after installation, `sdlc install ...` is the normal form.

---

## 11. Detailed schema implementation

Domain artifact schemas are not embedded in `specification.md`. They live under:

```text
.opencode/tools/sdlc/config/schemas/
```

A stage registry entry selects a schema by ID. The schema defines the domain fields; the common artifact contract defines only the machine metadata (`revision` and, for author artifacts, `based_on`).

Schema-specific validator checks live beside the schema and MUST declare their input schema.

Generic checks live under `config/checks/generic/`; schema-specific checks live under `config/checks/schemas/<schema>.yaml`.

---

## 12. Implementation sequence / phasing

### Phase 0 — OpenCode compatibility smoke test

No toolkit implementation depends on undocumented behavior.

Verify in the pinned supported OpenCode installation:

* coordinator can invoke `author`,
* coordinator can invoke `stage-reviewer`,
* custom tools appear,
* `sdlc_approve`, `sdlc_abandon`, and pre-freeze amendment permissions are correctly restricted,
* agent-specific permissions work,
* custom command can select the coordinator,
* Node CLI can be invoked from the OpenCode adapter,
* pinned config schema accepts the installed agent/tool definitions.

### Phase 1 — Generic vertical slice

Use deliberately neutral stage names:

```text
define
build
build-review
release
```

Prove:

* work-item creation,
* workflow snapshot,
* cold resume,
* `getWorkItemState` / `deriveWorkItemState`,
* schema validation,
* `sdlc_write`,
* review gate,
* terminal archive,
* Node CLI,
* OpenCode delegation,
* atomic writes.

No stage named `requirements` is used in Phase 1.

### Phase 2 — Workflow graph and review

Add:

* multiple workflow templates,
* `based_on`,
* upstream issues,
* revision cascades,
* graph validator,
* review round caps,
* workflow amendment.

Prove that two work-items can use different workflows simultaneously.

### Phase 3 — Architecture and investigation

Add:

* design stages,
* investigation stages,
* richer semantic checklists,
* arbitrary stage-specific artifact types.

### Phase 4 — Operational hardening

Add:

* approval checkpoints,
* hotfix workflows,
* living-document updates,
* installation hardening,
* source-to-deployment fixture tests and adapter path-resolution tests,
* approval-path and abandonment-path smoke tests,
* large-repository performance testing.

---

## 13. Technical decisions and alternatives considered

* **One author agent, many stage templates.** Split only if evidence requires different rigor/model/temperature per stage.
* **No machine-maintained navigation index.** The filesystem is the index; agents discover living documents through normal filesystem search and `rg`.
* **No JSON↔YAML conversion layer.** Artifact formats are fixed by class: JSON for machine artifacts, Markdown for narrative/control, YAML for registry/config/checklists.
* **No custom SDK-based subagent orchestration.** OpenCode's native Task mechanism and permissions are sufficient for v1.
* **Thin adapter.** `.opencode/tools/sdlc.ts` delegates to the deterministic Node CLI; it contains no workflow logic.
* **Transaction journal only for multi-file operations.** Single-file writes use atomic rename; multi-file operations use `.sdlc-txn.json`.
* **Policy snapshot at scaffold time.** Global/project configuration changes do not silently alter an existing work-item.
* **Registry hash recorded in `workflow.json`.** A registry change requires a new snapshot and explicit workflow amendment.