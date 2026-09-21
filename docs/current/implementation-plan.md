# 2. Implementation plans

## P-00 — OpenCode compatibility smoke test

### Goal
Verify the pinned OpenCode version supports all assumptions before building integration layers.

### Deliverables
- A throwaway fixture `.opencode/` package in the pinned OpenCode version.
- Checklist verifying:
  - project-local agents load;
  - primary agent can invoke subagents through Task;
  - subagent permissions restrict available subagents;
  - custom tools under `.opencode/tools/` are discovered;
  - per-agent tool allow/deny permissions work;
  - custom command can select an agent;
  - Node CLI can be invoked from a custom tool;
  - global vs project-local tool resolution behavior;
  - OpenCode config schema shape for agents/commands/tools.

### Testable acceptance criteria
- All checklist items pass in the pinned OpenCode release.
- Results are recorded in `tests/fixtures/opencode-compat/README.md`.
- Any failed assumption produces a specification amendment request before P-16/P-17/P-18 start.

### Dependencies
- None. This is the first gate.

---

## P-01 — Canonical source repository scaffold and build pipeline

### Goal
Create the canonical source tree and a deterministic build that produces the deployable payload.

### Deliverables
- Repository layout per `implementation.md §3`:
  - `src/cli/`
  - `src/lib/`
  - `src/config/`
  - `src/agents/`
  - `src/skills/`
  - `src/commands/`
  - `src/adapter/`
  - `tests/`
  - `scripts/build.ts`
  - `scripts/install.ts`
- `npm run build` must:
  - compile TypeScript to JavaScript;
  - copy config, checks, schemas, templates, agents, commands, skills into `dist/`;
  - produce `dist/tools/sdlc/bin/sdlc-cli.js`;
  - produce `dist/tools/sdlc.ts`;
  - write `manifest.json` with toolkit version, supported OpenCode version range, config schema, and build hash.
- Generated-file markers for deployed files.

### Testable acceptance criteria
- `npm run build` succeeds from a clean checkout.
- `dist/` contains every required deployable resource.
- Manifest contains required fields.
- A unit test verifies the build hash is deterministic for unchanged inputs.

### Dependencies
- None, except that the package version and OpenCode version range must be fixed.

---

## P-02 — CLI runtime skeleton and common protocol

### Goal
Establish the shared CLI runtime used by all commands.

### Deliverables
- Command parsing layer under `src/cli/`.
- Machine-readable JSON output by default.
- Optional `--human` output hook.
- Standard error envelope:

```json
{
  "error": {
    "code": "...",
    "message": "...",
    "details": {}
  }
}
```

- Exit-code table implementation:
  - 0 success
  - 2 invalid invocation
  - 3 repository/configuration error
  - 4 authorization/approval failure
  - 5 current-state conflict
  - 6 validation failure
  - 7 gate closed or workflow blocked
  - 8 recovery required
  - 9 internal error

### Testable acceptance criteria
- Contract tests assert exit codes and JSON shape for unknown commands, bad flags, missing repository, and internal errors.
- No command writes to stdout in a non-JSON format unless `--human` is requested.

### Dependencies
- P-01.

---

## P-03 — Filesystem primitives: atomic write, locking, transaction journal

### Goal
Implement the durability layer required by `specification.md §19.4`.

### Deliverables
- Single-file atomic write:
  - write `path.tmp`;
  - fsync file;
  - rename over target;
  - fsync directory where supported.
- Work-item lock file `.sdlc.lock`.
- Transaction journal `.sdlc-txn.json` with:
  - operation ID;
  - intended writes;
  - backups;
  - state `prepared` or `committed`.
- Recovery behavior on CLI startup:
  - `prepared`: restore backups and remove journal;
  - `committed`: complete remaining operations and remove journal;
  - unrecoverable: exit 8.

### Testable acceptance criteria
- Unit tests prove atomic write leaves either old or new content, never partial content.
- Concurrent mutation test proves second mutating invocation fails fast.
- Crash-injection tests:
  - crash after `prepared` restores original state;
  - crash after `committed` completes intended operation.
- Recovery failure exits 8.

### Dependencies
- P-01.
- P-02 for error/exit-code conventions.

---

## P-04 — Registry, configuration, schema, and checklist loading

### Goal
Implement loading and validation of all registry/config data and compute the registry hash.

### Deliverables
- Loaders for:
  - `config.yaml`
  - `stages.yaml`
  - `types.yaml`
  - `workflows.yaml`
  - `checks/generic/*.yaml`
  - `checks/schemas/*.yaml`
  - `schemas/*.json`
  - `templates/*.md`
- Registry validation:
  - actor enum: `author`, `stage-reviewer`, `script`;
  - completion mode enum: `artifact`, `review_gate`, `terminal`;
  - review stage must declare target, checklist, rework target;
  - review target must not be itself;
  - terminal `script` stage must declare supported `terminal.command` and `completion_file`;
  - workflow templates must reference registered stages and end in terminal stage;
  - types must resolve to `types.yaml`.
- Registry snapshot hash computation covering:
  - `stages.yaml`
  - `types.yaml`
  - schemas participating in validation
  - checks participating in validation

### Testable acceptance criteria
- Unit tests accept valid registries and reject malformed registries with precise findings.
- Registry hash is deterministic.
- Changing a schema or checklist changes the hash.
- Changing a prompt template does not change the hash, unless you later decide templates are registry-covered.

### Dependencies
- P-01.

---

## P-05 — Artifact schema validation engine and generic validator

### Goal
Implement mechanical validation as a pure function over provided data.

### Deliverables
- JSON Schema validation for stage artifacts, `workflow.json`, upstream issues, approvals, and archive metadata.
- Generic validator checks:
  - workflow stage IDs exist;
  - workflow ends in terminal stage;
  - stage appears at most once;
  - review target earlier than review stage and is author stage;
  - rework target exists;
  - artifact inputs exist and precede consumers;
  - `based_on` entries resolve and are not newer than source revisions;
  - artifact revisions monotone;
  - registry/config snapshot hash valid;
  - required artifact metadata present;
  - review checklist fully answered;
  - `gate_cleared == findings.length == 0`;
  - unique IDs;
  - referenced check IDs exist;
  - supersedes chains contain no cycles.
- Finding schema:

```json
{
  "code": "...",
  "severity": "blocking",
  "stage": "...",
  "implicated_stage": "...",
  "path": "...",
  "message": "..."
}
```

- Explicit separation: lifecycle conditions are not validator findings.

### Testable acceptance criteria
- Fixture tests cover every check in `specification.md §26`:
  - dependency cycle;
  - dangling reference;
  - revision inversion;
  - stale `based_on`;
  - invalid stage ID;
  - review targeting later stage;
  - invalid registry/config snapshot.
- Validator is pure: no filesystem imports.

### Dependencies
- P-04.

---

## P-06 — Pure state core: `deriveWorkItemState`

### Goal
Implement state derivation as a pure function with no I/O and no stage-name semantics.

### Deliverables
- `DerivationInput` type containing:
  - workflow;
  - registry snapshot;
  - policy snapshot;
  - stage artifacts;
  - review artifacts;
  - upstream issues;
  - approvals;
  - terminal completion evidence.
- `WorkItemState` union per `specification.md §11.5`.
- `ActiveReason` union covering at least:
  - `awaiting_approval`
  - `artifact_absent`
  - `input_stale`
  - `review_absent`
  - `review_stale`
  - `rework_required`
  - `open_upstream_issue`
  - `validator_findings`
  - `terminal_pending`
  - `terminal_recovery_required`
- Derivation precedence per `§11.7`:
  1. missing workflow -> `uninitialized`
  2. invalid workflow/registry/policy -> `invalid`
  3. persisted abandoned -> `abandoned`
  4. blocking structural findings -> `invalid` or earliest implicated stage
  5. open upstream issue -> earliest valid target stage
  6. stage walk using completion modes
  7. checkpoint absent/stale -> active at checkpoint stage
  8. artifact absent -> active at that stage
  9. stale declared input -> active at that stage
  10. review absent/stale -> active at review stage
  11. closed gate with rounds remaining -> active at rework stage
  12. closed gate at cap -> `blocked`
  13. incomplete terminal -> active at terminal stage
  14. terminal evidence but not moved -> `terminal_recovery_required`

### Testable acceptance criteria
- Fixture suite covers every routing case in `specification.md §26`.
- Same fixture with stage renamed from `define` to `specification` produces equivalent state without code change.
- Static test asserts `src/lib/state/` imports no filesystem, config, or model modules.
- Static test asserts no forbidden literals in the state core:
  - `requirements`
  - `design`
  - `planning`
  - `implementation`
  - `archive`
- `WorkItemState.stage` is null unless status is `active`.

### Dependencies
- P-05.

---

## P-07 — CLI facade: `getWorkItemState`

### Goal
Implement the I/O facade that assembles derivation input and delegates to the pure core.

### Deliverables
- Resolve repository root and work-item location.
- Detect `docs/work-items/done/` and return `done` without invoking the pure core.
- Load:
  - `workflow.json`
  - registry snapshot recorded by the work-item
  - artifacts
  - review artifacts
  - upstream issues
  - approvals
  - terminal completion evidence
- Verify installed registry hash matches recorded hash.
- Return `uninitialized` when `workflow.json` is absent.
- Read-only behavior.

### Testable acceptance criteria
- Facade/core parity tests exercise both against the same fixtures.
- Facade returns `done` only for items under `done/`.
- Registry hash mismatch returns `invalid`.
- Missing `workflow.json` returns exact `uninitialized` object.
- Integration test proves the command writes nothing.

### Dependencies
- P-04, P-06.

---

## P-08 — `sdlc scaffold`

### Goal
Create work-items with immutable `init.md`, versioned `workflow.json`, policy snapshot, and registry hash.

### Deliverables
- Command:

```bash
sdlc scaffold <slug> \
  --type <type> \
  --stages <json-file> \
  --freeze-after <stage|null> \
  --reason <text>
```

- Create:
  - `docs/work-items/<slug>/init.md`
  - `docs/work-items/<slug>/workflow.json`
- Validate before writing:
  - type exists in `types.yaml`;
  - every stage exists in registry;
  - stage sequence is structurally valid;
  - workflow ends in terminal stage;
  - freeze point rules:
    - if `freeze_after` is null, `workflow_authoring_stage` must be null;
    - authoring stage must occur at or before `freeze_after`;
  - duplicate live slug rejected.
- Record:
  - `revision: 1`
  - `status: active`
  - `registry_sha256`
  - `policy_snapshot`
  - initial `stage_history` entry

### Testable acceptance criteria
- Golden-file test for `init.md` and `workflow.json`.
- Exit 0 on success.
- Exit 5 for duplicate live slug.
- Exit 6 for invalid workflow/type/configuration.
- Exit 2 for invalid invocation.
- Non-terminal last stage is rejected.
- Frozen-at-scaffold case produces `frozen_at` and null authoring stage.

### Dependencies
- P-02, P-03, P-04.

---

## P-09 — `sdlc write` for author stages

### Goal
Implement the only normal path for author machine artifacts.

### Deliverables
- Command:

```bash
sdlc write <slug> <stage> [--file X | --stdin]
```

- Enforce:
  - stage is current;
  - required checkpoint approval exists and is fresh, pending ISSUE B resolution;
  - payload validates against stage schema;
  - caller cannot supply `revision` or `based_on`.
- Compute:
  - next `revision`;
  - `based_on` from declared stage inputs and current upstream artifact revisions.
- Atomic write for normal case.
- Journaled multi-file write when completing the freeze stage:
  - write artifact;
  - set `workflow.json.frozen_at`;
  - same transaction.

### Testable acceptance criteria
- Revision increments monotonically.
- `based_on` matches declared inputs exactly.
- Exit 5 when stage is not current.
- Exit 6 for invalid payload.
- Payload containing caller-supplied `revision` or `based_on` is rejected.
- Freeze test: writing the freeze-stage artifact sets `frozen_at` atomically; crash simulation leaves either both changes or neither.

### Dependencies
- P-03, P-04, P-05, P-07, P-08.

---

## P-10 — Review machinery: review `sdlc write` and `sdlc gate`

### Goal
Implement review rounds, gate evaluation, and round caps.

### Deliverables
- Review-stage behavior for `sdlc write`:
  - one call creates exactly one round;
  - CLI computes:
    - review artifact `revision`;
    - round number;
    - `reviewed_revision`;
    - `gate_cleared`;
  - reviewer supplies:
    - `findings`;
    - `observations`;
    - `checks_answered`.
- `sdlc gate <slug> <stage>`:
  - evaluates validator state for target and latest review round;
  - does not mutate state;
  - exit 7 when gate closed or workflow blocked.
- Round cap:
  - `review.max_rounds` from `policy_snapshot`;
  - closed latest round at cap derives `blocked`.

### Testable acceptance criteria
- One write produces one round.
- Empty findings clear gate.
- Observations never affect gate.
- `gate_cleared` cannot be reviewer-supplied.
- `reviewed_revision` equals target revision at write time.
- Round cap fixture returns:

```json
{
  "status": "blocked",
  "stage": null,
  "reason": "max_rounds_reached"
}
```

- Gate command returns stable JSON and does not write.

### Dependencies
- P-09.

### Gated item
- Recovery from `blocked` due to round cap is gated on ISSUE A.

---

## P-11 — Upstream issues

### Goal
Implement raising and resolving upstream issues with caps and supersedes semantics.

### Deliverables
- `sdlc raise-upstream`:

```bash
sdlc raise-upstream <slug> \
  --stage X \
  --target Y \
  --text "..." \
  [--target-revision N]
```

- Validate:
  - target exists;
  - target is earlier;
  - target is author stage;
  - target artifact matches registry;
  - open issue cap from policy snapshot.
- Create `upstream-issues.json` on first use.
- `sdlc resolve-upstream`:

```bash
sdlc resolve-upstream <slug> \
  --issue UP-001 \
  --stage X \
  --artifact <file> \
  --resolution "..."
```

- Resolution:
  - only target stage resolves;
  - resolution and artifact revision happen in one journaled operation;
  - never reopen;
  - support `supersedes`;
  - automatically close superseded open issue;
  - reject cycles.

### Testable acceptance criteria
- Open issue causes derivation to route to earliest target stage.
- Cap counts only open issues.
- Resolving revises target artifact and marks issue resolved atomically.
- Superseding open issue closes old issue with `superseded by ...`.
- Invalid target exits 5.
- Cap exceeded exits 5.

### Dependencies
- P-09.

---

## P-12 — `sdlc amend-workflow`

### Goal
Implement controlled workflow amendment before and after freeze.

### Deliverables
- Command:

```bash
sdlc amend-workflow <slug> \
  --stages <json-file> \
  --freeze-after <stage|null> \
  --reason <text> \
  [--type <type>] \
  [--stage <stage-id> | --human]
```

- Pre-freeze `--stage` path:
  - workflow not frozen;
  - `--stage` equals current stage;
  - `--stage` equals `workflow_authoring_stage`;
  - record coordinator identity.
- Human path:
  - interactive TTY required;
  - allowed before or after freeze;
  - record human identity.
- Neither `--stage` nor `--human`: exit 2.
- Every amendment:
  - increments `workflow.json.revision`;
  - appends full resulting workflow plus reason to `stage_history`;
  - recomputes registry snapshot hash;
  - validates new workflow, including terminal reachability;
  - uses atomic single-file write for `workflow.json`.

### Testable acceptance criteria
- Authorization matrix tests:
  - wrong stage exits 4 or 5;
  - frozen workflow on non-human path exits 5;
  - missing TTY on human path exits 4;
  - no auth flag exits 2.
- Invalid amended workflow is not written.
- History entry contains full resulting fields.
- Registry hash refresh is recorded.

### Dependencies
- P-04, P-07, P-08.

### Gated item
- Policy snapshot refresh on amendment is gated on ISSUE A.

---

## P-13 — Human terminal operations: `sdlc approve` and `sdlc abandon`

### Goal
Implement approval and abandonment as human-only CLI operations.

### Deliverables
- `sdlc approve <slug> <stage>`:
  - interactive TTY required;
  - stage must be awaiting approval;
  - compute fingerprint from workflow revision and transitive closure of approved stage inputs;
  - compare with stored approval artifact;
  - write `approvals/<stage>.json` atomically;
  - record approver identity from `--approver` or platform identity.
- Approval idempotency:
  - same fingerprint returns existing artifact unchanged;
  - changed fingerprint requires fresh approval.
- `sdlc abandon <slug> --reason <text>`:
  - interactive TTY required;
  - work-item must be live;
  - set persisted status to `abandoned`;
  - write abandonment object;
  - append history;
  - increment workflow revision;
  - idempotent for already-abandoned live work-item;
  - exit 5 for done work-item.

### Testable acceptance criteria
- Non-TTY exits 4.
- Missing approver identity exits 4.
- Stage not awaiting approval exits 5.
- Stale fingerprint exits 5.
- Re-approval of same fingerprint returns identical artifact and unchanged `approved_at`.
- Abandonment updates workflow atomically.
- Re-abandonment is a no-op.
- Done work-item abandonment exits 5.

### Dependencies
- P-03, P-07, P-08.

---

## P-14 — Terminal stages and `sdlc archive`

### Goal
Implement terminal completion, archive record validation, and move to `done/`.

### Deliverables
- Command:

```bash
sdlc archive <slug> [--stdin | --file X]
```

- Validate archive record:
  - required frontmatter/metadata;
  - either non-empty `docs_updated` or non-null `no_update_reason`;
  - narrative sections present.
- Verify workflow is otherwise complete.
- Write `archive.md`.
- Move work-item to:

```text
docs/work-items/done/yyyy-MM-dd-HH-mm-<slug>/
```

- Use transaction journal for:
  - writing completion artifact;
  - moving directory.
- Support recovery for `terminal_recovery_required`.

### Testable acceptance criteria
- Incomplete workflow exits 7.
- Invalid archive record exits 2 or 6, according to whether it is invocation or validation failure.
- Crash during archive recovers via journal.
- After success, `getWorkItemState` returns `done`.
- Archive timestamp uses archive operation time.
- Rerunning recovery completes move without duplicating directory.

### Dependencies
- P-03, P-07.

---

## P-15 — `sdlc list` and `sdlc doctor`

### Goal
Implement read-only operational visibility commands.

### Deliverables
- `sdlc list`:
  - discover work-items from filesystem only;
  - derive canonical `WorkItemState` for each live work-item;
  - report `done` for items under `done/`;
  - optional display subtypes derived from active reason;
  - include observation counts where useful.
- `sdlc doctor`:
  - report active installation;
  - report shadowed installations;
  - report registry/config hash mismatches;
  - report OpenCode compatibility status;
  - make no mutations.

### Testable acceptance criteria
- `sdlc list` works with no index file.
- Statuses are canonical `WorkItemState.status` values only.
- `done/` items are reported as done.
- Doctor detects global shadowed by project-local installation.
- Doctor changes no files.

### Dependencies
- P-07.
- Doctor installation awareness depends partially on P-18, but a first version can land earlier.

---

## P-16 — OpenCode adapter: `.opencode/tools/sdlc.ts`

### Goal
Provide thin OpenCode tool adapters that delegate to the deterministic CLI.

### Deliverables
- Adapter exports:
  - `sdlc_scaffold`
  - `sdlc_get_work_item_state`
  - `sdlc_validate`
  - `sdlc_write`
  - `sdlc_gate`
  - `sdlc_raise_upstream`
  - `sdlc_resolve_upstream`
  - `sdlc_archive`
  - `sdlc_list`
  - `sdlc_amend_workflow`
- Must not export:
  - `sdlc_approve`
  - `sdlc_abandon`
- Resolve CLI relative to adapter installation location.
- Resolve work-item data relative to active target repository.
- No workflow logic in adapter.

### Testable acceptance criteria
- Adapter path-resolution tests distinguish adapter location from repository location.
- Each tool maps to the corresponding CLI command.
- Tool output passes through CLI JSON and exit-code semantics.
- Static test asserts `sdlc_approve` and `sdlc_abandon` are not exported.
- Static test asserts adapter contains no state-derivation logic.

### Dependencies
- P-00.
- P-08 through P-15 for the full tool surface.
- For Phase 1, at least P-08, P-09, P-10, P-14.

---

## P-17 — Agents, skills, and command assets

### Goal
Author deployed OpenCode agents, skills, and the optional `/sdlc-next` command.

### Deliverables
- Agents:
  - `coordinator.md`
  - `author.md`
  - `stage-reviewer.md`
  - `archiver.md`
- Permission matrix implementation:
  - coordinator: allowed subagents `author`, `stage-reviewer`, `archiver`; denied `sdlc_approve`, `sdlc_abandon`, arbitrary shell, arbitrary subagents;
  - author: read, edit code, `sdlc_write`, `sdlc_raise_upstream`; denied approve/abandon/amend/reviewer tools;
  - stage-reviewer: read, `sdlc_write`, `sdlc_raise_upstream`; denied project-file edits and approve/abandon/amend;
  - archiver: read, edit only under `docs/current/`, `sdlc_archive`; denied code edits, approve/abandon/amend.
- Skills:
  - `qna/SKILL.md`
  - `work-item-scaffold/SKILL.md`
  - `archive-work-item/SKILL.md`
- Optional command:
  - `commands/sdlc-next.md`

### Testable acceptance criteria
- Assets validate against the pinned OpenCode config schema discovered in P-00.
- Lint tests assert deny lists include `sdlc_approve` and `sdlc_abandon` for all agents.
- Coordinator subagent allow list contains exactly the three permitted subagents.
- Reviewer denies file-edit permissions.
- Archiver path restriction is expressed explicitly.

### Dependencies
- P-00.
- P-16 for tool names.

---

## P-18 — `sdlc install`

### Goal
Install the generated deployment payload into a target repository or global OpenCode location.

### Deliverables
- Command:

```bash
sdlc install --target <repo> --scope project|global [--force]
```

- Bootstrap form:

```bash
node dist/tools/sdlc/bin/sdlc-cli.js install ...
```

- Verify:
  - Node availability;
  - supported OpenCode version range, using mechanism confirmed in P-00.
- Copy deployment payload into target `.opencode/` tree.
- Refuse overwrite without `--force`.
- Record installation scope and version in `.opencode/tools/sdlc/manifest.json`.

### Testable acceptance criteria
- Fresh repository installation succeeds with one invocation.
- Existing installation without `--force` exits 5.
- `--force` replaces installed payload.
- Manifest records version and scope.
- Unsupported Node or OpenCode version exits 3.

### Dependencies
- P-00.
- P-01.
- P-16 and P-17 for deployable content.

---

## P-19 — Source-to-deployment parity suite

### Goal
Guarantee deployed files are generated from canonical source and remain in sync.

### Deliverables
- Parity tests comparing canonical resources to deployed resources by content hash.
- Coverage for:
  - agents;
  - skills;
  - commands;
  - config;
  - schemas;
  - checks;
  - templates;
  - CLI bundle;
  - adapter.
- Generated-file marker validation.

### Testable acceptance criteria
- Every canonical resource has a deployed counterpart.
- Content hashes match after build.
- Editing a deployed file directly causes parity failure.
- Missing resource causes parity failure.

### Dependencies
- P-01.
- Complete after P-16, P-17, P-18.

---

## P-20 — Phase 1 vertical slice: neutral end-to-end workflow

### Goal
Prove the whole system end-to-end using deliberately neutral stage names.

### Deliverables
- Phase 1 registry and workflow fixture using:
  - `define`
  - `build`
  - `build-review`
  - `release`
- End-to-end scripted scenario:
  1. scaffold;
  2. write define artifact;
  3. freeze;
  4. write build artifact;
  5. review build;
  6. rework if needed;
  7. clear gate;
  8. archive;
  9. verify done state.
- Cold-resume test:
  - interrupt after each step;
  - rerun `get-work-item-state`;
  - derive same next action.
- OpenCode delegation smoke:
  - coordinator invokes author and stage-reviewer;
  - tools appear;
  - permissions deny human operations.

### Testable acceptance criteria
- No stage named `requirements` is used.
- CLI-only end-to-end passes.
- Cold resumption passes after every step.
- OpenCode smoke passes in pinned release.
- All writes are atomic or journaled.
- Source-to-deployment parity passes.

### Dependencies
- P-08, P-09, P-10, P-14.
- P-16 and P-17 for OpenCode smoke.
- P-00.

---

## P-21 — Phase 2: workflow graph, review depth, and multiple workflows

### Goal
Prove data-driven workflows under richer conditions.

### Deliverables
- Multiple workflow templates.
- Custom stage arrays not present in `workflows.yaml`.
- Two concurrent live work-items with different workflows.
- Full `based_on` revision cascade tests.
- Graph validator tests:
  - cycles;
  - orphans;
  - dangling references;
  - stale revisions.
- Review round cap behavior.
- Workflow amendment before and after freeze.
- Apply ISSUE A resolution once decided.

### Testable acceptance criteria
- Changing stage names in config requires no CLI code change.
- Two work-items derive state independently.
- Stale downstream artifacts are detected.
- Amendment validation rejects non-terminal final stage.
- Round cap block and recovery path behave according to the resolved ISSUE A decision.

### Dependencies
- P-20.
- ISSUE A resolution.

---

## P-22 — Phase 3: architecture, investigation, and schema-specific checks

### Goal
Support richer stage types without changing the state core.

### Deliverables
- Additional stage definitions:
  - design/architecture-style stages;
  - investigation stages.
- Additional artifact schemas.
- Schema-specific validator checks under `config/checks/schemas/`.
- Richer semantic review checklists under `config/checks/`.
- Stage-specific templates.

### Testable acceptance criteria
- New stages work solely through registry/config additions.
- Schema-specific checks fire only for declaring schema.
- State core source is unchanged by adding these stages.
- Review checklists are fully answered by review artifacts.

### Dependencies
- P-21.

---

## P-23 — Phase 4: operational hardening

### Goal
Complete v1 operational readiness and acceptance criteria.

### Deliverables
- Approval checkpoint end-to-end tests.
- Hotfix workflow fixture per `implementation.md Appendix B`.
- Living-document update flow via archiver skill.
- Large-repository performance tests.
- Installation hardening:
  - shadowed installs;
  - force overwrite;
  - manifest drift.
- Approval-path and abandonment-path smoke tests.
- Full `specification.md §26` definition-of-done matrix.

### Testable acceptance criteria
- Checkpoint blocks write until approval.
- Stale approval blocks again.
- Hotfix workflow completes without CLI code change.
- Archiver updates only `docs/current/`.
- Performance targets from implementation acceptance criteria pass.
- All definition-of-done items have named tests.

### Dependencies
- P-22.

---

# 3. Dependency overview

```text
P-00 OpenCode smoke
 │
 ├───────────────────────────────┐
 │                               ▼
P-01 repo/build ──► P-02 CLI runtime ──► P-08..P-15 commands
 │                                       ▲
 ├──► P-03 fs primitives ────────────────┤
 │                                       │
 ├──► P-04 registry loading              │
 │       │                               │
 │       ▼                               │
 │     P-05 validator                    │
 │       │                               │
 │       ▼                               │
 │     P-06 pure state core              │
 │       │                               │
 │       ▼                               │
 │     P-07 facade ──────────────────────┘
 │
 ├──► P-16 adapter ◄── P-00
 ├──► P-17 agents/skills ◄── P-00, P-16
 ├──► P-18 install ◄── P-00, P-01, P-16, P-17
 ├──► P-19 parity ◄── P-01, P-16, P-17, P-18
 │
 ▼
P-20 Phase 1 vertical slice
 │
 ▼
P-21 Phase 2 graph/review/multi-workflow
 │
 ▼
P-22 Phase 3 richer stages/checks
 │
 ▼
P-23 Phase 4 hardening
```

Command-level dependencies:

```text
P-08 scaffold
 ├─► P-09 write author artifacts
 │    ├─► P-10 review + gate
 │    └─► P-11 upstream issues
 ├─► P-12 amend-workflow
 ├─► P-13 approve/abandon
 ├─► P-14 archive
 └─► P-15 list/doctor
```

---

# 4. Recommended sequencing

1. **P-00** first, because OpenCode assumptions are load-bearing.
2. **P-01 through P-07** as the deterministic foundation.
3. **P-08 through P-15** as the CLI surface.
4. **P-16 through P-18** as the OpenCode integration surface.
5. **P-19** continuously, but enforced once deployable assets exist.
6. **P-20** as the first end-to-end proof.
7. **P-21 through P-23** as phased expansion and hardening.

The only item I recommend not implementing until you answer is the **policy amendment mechanism in ISSUE A**, because it affects how a work-item recovers from `blocked: max_rounds_reached`.