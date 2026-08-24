# src/scripts/lib/checks/

## Responsibility
The capped structural-check catalog (CMP-004, DEC-003/DEC-004) — the single
extension path for structural validation logic. Stages select checks
declaratively in their `structural-checks.yaml` with parameters; this directory
holds the fixed set of eleven generic `CheckFn` implementations plus the
dispatch. Adding or changing a check is a design-review event (AGENTS.md §9).

## Design Patterns
- **Uniform check contract**: every check is a `CheckFn` (`shared.ts:8`):
  `(artifact, params, context) => Finding[]`, where `context: CheckContext`
  (`shared.ts:3`) carries `{cwd, changeRoot}`. Findings use the frozen `Finding`
  shape `{check, severity, category, target, finding, fix?}`
  (`../types.ts:18`); severities are `blocking` or `minor`, categories
  `structural` / `traceability` / `ambiguity` / `completeness`.
- **Catalog registry + param validation**: `CHECK_CATALOG`
  (`index.ts:20`) maps check name → `{fn, requiredParams}`.
  `runStageChecks(stageId, stageFolder, artifact, context, checksDoc)`
  (`index.ts:49`) iterates the stage's declarations; an unknown check name or a
  missing required parameter throws a startup error naming the stage folder and
  the check entry (mirrored at CI time by `bin/validate-policies.ts`).
- **Shared traversal helpers** (`shared.ts`): `getTopArray(obj, field)`
  (`:29`) — safe top-level array access; `resolvePath(artifact, pathSpec)`
  (`:36`) — resolves either a plain string field or `array[].field` into
  `{value, target}` pairs (target shaped like `array[0].field`); `hasWord(text,
  word)` (`:15`) — whole-word, case-insensitive regex match (escaped);
  `countSentences(text)` (`:21`) — split on `[.!?]+`, count non-empty segments.
- **Word profiles** (`words.ts`): `BLOCKING_WORDS` (`:5` — fast, user-friendly,
  gracefully, appropriately, it works, it handles, easy, simple, robust,
  seamless, intuitive, optimal, as needed) and `ADVISORY_WORDS` (`:21` — should,
  reasonable, sufficient, normal, expected, proper, maybe, probably). These are
  the default lists for `forbidden-words`; per-field/per-check overrides are
  accepted.
- **DFS cycle detection** (`dependency-acyclic.ts:30`): white/gray/black coloring
  over the task `depends_on` graph; first cycle found yields one blocking
  finding.

## Data & Control Flow
The eleven checks (all in this folder):

| Check | Validates | Key params | File |
|---|---|---|---|
| `unique-ids` | Duplicate `id` within each configured array | `arrays`, `id_field?` | unique-ids.ts:6 |
| `ref-exists` | References in `from.array[].from.field` resolve to ids present in `to.arrays[].to.field` of `to.file` (or this artifact) | `from{array,field}`, `to{file?,arrays,field}` | ref-exists.ts:15 |
| `referenced-by` | Orphan detection: ids in `array` not referenced by any `by[].array[].ref_field` (minor) | `array`, `by[{array,ref_field}]`, `id_field?` | referenced-by.ts:12 |
| `duplicate-refs` | Duplicate entries inside each item's reference list (minor) | `array`, `list_field` | duplicate-refs.ts:14 |
| `given-when-then` | Each entry's statement contains Given/When/Then keywords | `array`, `statement_field?` | given-when-then.ts:14 |
| `forbidden-words` | Blocking/advisory word scan over configured text fields (blocking first; advisory only when no blocking hit on the same target) | `fields[{path,blocking?,advisory?} \| path]`, `blocking?`, `advisory?` | forbidden-words.ts:14 |
| `sentence-count` | A text field has `min`..`max` sentences (minor) | `field`, `min`, `max` | sentence-count.ts:16 |
| `required-note-for-status` | Entries whose `status` is in `statuses` carry a non-empty note | `array`, `statuses`, `note_field?` | required-note-for-status.ts:15 |
| `all-tasks-terminal` | Every entry's `status` is one of the allowed terminal statuses | `array`, `allowed_statuses` | all-tasks-terminal.ts:15 |
| `dependency-acyclic` | `depends_on` graph over the array is acyclic (DFS) | `array`, `id_field?`, `depends_field?` | dependency-acyclic.ts:15 |
| `dependency-order` | No task depends on a task listed later in the array | `array`, `id_field?`, `depends_field?` | dependency-order.ts:15 |

Execution sequence (called by `validateArtifact` in `../validate.ts:79`):
1. `runStageChecks` receives the stage's parsed `structural-checks.yaml`
   (`StructuralChecksDoc`, `index.ts:39` — `{version?, checks[]}`).
2. For each declaration: catalog lookup (throw on unknown), required-param
   check (throw on missing), then `spec.fn(artifact, params, context)`.
3. Findings from all checks are concatenated, in declaration order, into the
   `validateArtifact` result.

## Integration
- **Consumed by**: `../validate.ts` `validateArtifact` (the single validation
  path), therefore authoring `--finalize`, the review stages, and
  `bin/lint-artifact.ts` — identical findings in all three.
- **Validated at CI time by**: `bin/validate-policies.ts`, which resolves each
  stage's declarations against `CHECK_CATALOG` (names + requiredParams) and
  compiles each stage `schema.yaml`.
- **Depends on**: `../shared.ts`/`../words.ts` (same folder), `../context.ts`
  `safeReadYaml` (cross-file reads in `ref-exists` via `context.changeRoot`),
  `../types.ts` `Finding`; per-stage `structural-checks.yaml` under
  [../../stages/](../../stages/codemap.md).
- **Emits**: `Finding` objects (not `errors.yaml` codes) with `check` names as
  in the table (note `forbidden-words` emits `check: 'forbidden-word'`).