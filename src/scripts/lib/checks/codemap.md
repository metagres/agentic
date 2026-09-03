# src/scripts/lib/checks/

## Responsibility
The capped structural-check catalog (CMP-002, CMP-004, DEC-003/DEC-004) — the single
extension path for structural validation logic. Stages select checks
declaratively in their `structural-checks.yaml` with parameters; this directory
holds the fixed set of ten generic `CheckFn` implementations plus the
dispatch. Adding or changing a check is a design-review event (AGENTS.md §9).

## Design Patterns
- **Uniform check contract**: every check is a `CheckFn` (`shared.ts:9`):
  `(artifact, params, context) => Finding[]`, where `context: CheckContext`
  (`shared.ts:3`) carries `{cwd, changeRoot}`. Findings use the frozen `Finding`
  shape `{check, severity, category, target, finding, fix?}`
  (`../types.ts:18`); severities are `blocking` or `minor`, categories
  `structural` / `traceability` / `ambiguity` / `completeness`.
- **Catalog registry + param validation**: `CHECK_CATALOG`
  (`index.ts:26`) maps check name → `{fn, requiredParams, pathParams?}`.
  `runStageChecks(stageId, stageFolder, artifact, context, checksDoc)`
  (`index.ts:66`) iterates the stage's declarations; an unknown check name or a
  missing required parameter throws a startup error naming the stage folder and
  the check entry (mirrored at CI time by `bin/validate-policies.ts`).
  `pathParams` (`PathParamSpec`, `index.ts:12`) declares which parameter
  subtrees bear path selectors (`{spec, kind: 'collection' | 'leaf'}`) and
  drives the declaration path validation in `../validate.ts`.
- **Artifact path resolver delegation** (`shared.ts`): `getTopArray(obj, field)`
  (`:31`) and `resolvePath(artifact, pathSpec)` (`:43`) delegate to
  `../artifact-paths.ts` (`resolveCollections` / `resolveLeafValues`) keeping
  their exported signatures; single-segment and two-segment specs are
  byte-identical with the pre-resolver behavior, longer specs resolve through
  the full `segment([].segment)*` grammar. `hasWord(text, word)` (`:17`) —
  whole-word, case-insensitive regex match (escaped); `countSentences(text)`
  (`:23`) — split on `[.!?]+`, count non-empty segments.
- **Path-addressed array selection**: `unique-ids`, `ref-exists`, and
  `given-when-then` resolve collection selectors through
  `resolveCollections` (`../artifact-paths.ts:110`); `forbidden-words`
  resolves leaf paths through `resolveLeafValues`. A selector without `[]`
  addresses a top-level node; a `[]`-marked segment iterates the array-valued
  property it names; absent properties and empty arrays yield empty results
  and never error.
- **unique-ids scopes** (`unique-ids.ts`): plain-name `arrays` entries keep
  today's per-array scope and finding text (`Duplicate ID '<id>' in '<name>'`);
  each `unions` group (`{arrays: [selector, ...]}`) enforces ONE uniqueness
  scope across the union of the path-resolved collections, its duplicate
  finding (`Duplicate ID '<id>' at <loc1>, <loc2>`) naming every containing
  entry location with the specs joined by `' + '` as target.
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
The ten checks (all in this folder):

| Check | Validates | Key params | File |
|---|---|---|---|
| `unique-ids` | Duplicate `id` within each configured array (per-array scope) and across each `unions` group (one scope over the union of path-resolved collections) | `arrays`, `unions?`, `id_field?` | unique-ids.ts:9 |
| `ref-exists` | References in `from.array[].from.field` resolve to ids present in `to.arrays[].to.field` of `to.file` (or this artifact); `to.arrays` entries may be path selectors resolved against the target document | `from{array,field}`, `to{file?,arrays,field}` | ref-exists.ts:16 |
| `duplicate-refs` | Duplicate entries inside each item's reference list (minor) | `array`, `list_field` | duplicate-refs.ts:14 |
| `given-when-then` | Each entry's statement contains Given/When/Then keywords; `arrays` is a string or string list (a list evaluates the union); findings target the full nested statement path | `arrays`, `statement_field?` | given-when-then.ts:9 |
| `forbidden-words` | Blocking/advisory word scan over configured text fields (blocking first; advisory only when no blocking hit on the same target); multi-segment leaf paths resolve through the resolver | `fields[{path,blocking?,advisory?} \| path]`, `blocking?`, `advisory?` | forbidden-words.ts:14 |
| `sentence-count` | A text field has `min`..`max` sentences (minor) | `field`, `min`, `max` | sentence-count.ts:16 |
| `required-note-for-status` | Entries whose `status` is in `statuses` carry a non-empty note | `array`, `statuses`, `note_field?` | required-note-for-status.ts:15 |
| `all-tasks-terminal` | Every entry's `status` is one of the allowed terminal statuses | `array`, `allowed_statuses` | all-tasks-terminal.ts:15 |
| `dependency-acyclic` | `depends_on` graph over the array is acyclic (DFS) | `array`, `id_field?`, `depends_field?` | dependency-acyclic.ts:15 |
| `dependency-order` | No task depends on a task listed later in the array | `array`, `id_field?`, `depends_field?` | dependency-order.ts:15 |

Execution sequence (called by `validateArtifact` in `../validate.ts`):
1. `validateCheckDeclarations` (`../validate.ts`) runs first: every
   `[]`-bearing parameter string must sit inside a `pathParams` slot of its
   check and must resolve through the governing stage schema (the stage's own
   `schema.yaml`, or for `ref-exists` `to.file` the schema of the stage owning
   that artifact; a file no stage owns falls back to grammar checks). A
   malformed or unsupported path throws naming the stage folder and the
   declaration.
2. `runStageChecks` receives the stage's parsed `structural-checks.yaml`
   (`StructuralChecksDoc`, `index.ts:56` — `{version?, checks[]}`).
3. For each declaration: catalog lookup (throw on unknown), required-param
   check (throw on missing), then `spec.fn(artifact, params, context)`.
4. Findings from all checks are concatenated, in declaration order, into the
   `validateArtifact` result.

## Integration
- **Consumed by**: `../validate.ts` `validateArtifact` (the single validation
  path), therefore authoring `--finalize`, the review stages, and
  `bin/lint-artifact.ts` — identical findings in all three.
- **Validated at CI time by**: `bin/validate-policies.ts`, which resolves each
  stage's declarations against `CHECK_CATALOG` (names + requiredParams), runs
  `validateCheckDeclarations` at startup, and compiles each stage
  `schema.yaml`.
- **Depends on**: `../artifact-paths.ts` (path grammar and resolution),
  `../shared.ts`/`../words.ts` (same folder), `../context.ts`
  `safeReadYaml` (cross-file reads in `ref-exists` via `context.changeRoot`),
  `../types.ts` `Finding`; per-stage `structural-checks.yaml` under
  [../../stages/](../../stages/codemap.md).
- **Emits**: `Finding` objects (not `errors.yaml` codes) with `check` names as
  in the table (note `forbidden-words` emits `check: 'forbidden-word'`).
