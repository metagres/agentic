# @agentic/checks

A self-contained, project-agnostic, **JSON-only** structural checks library.
It registers ten structural checks in a dictionary-style registry, fires any
check synchronously via `run(options)`, and documents every parameter of every
check through a per-check manifest that also feeds `--help`.

- Zero runtime dependencies (Node builtins only).
- No YAML anywhere: artifacts, parameters, and CLI input are JSON.
- No references to any host project: the library works for any JSON documents.
- Static registry — no dynamic loading. Access a check by name and call it.

## Install / import

Within this monorepo the package is a workspace, so any package can import it
directly:

```ts
import { checks } from '@agentic/checks';
// or from source:
import { checks } from './packages/checks/src/index.ts';
```

Consuming the TypeScript sources directly requires Node >= 22.18 (native type
stripping). For older runtimes build the bundle first and import
`./dist/index.js`:

```sh
npm run build   # in packages/checks
```

## Usage

```ts
import { checks, listChecks, runCheck, checkHelp } from '@agentic/checks';

// Fire a check dictionary-style. Returns Finding[] synchronously.
const findings = checks['unique-ids'].run({
  artifact,                                          // JSON object to validate
  params: { arrays: ['tasks'] },                     // check parameters
});

// Per-check parameter documentation.
console.log(checks['unique-ids'].help());            // rendered --help text
console.log(checks['unique-ids'].manifest.params);   // structured ParamSpec[]

// Convenience wrappers.
const manifests = listChecks();                      // every check's manifest
runCheck('ref-exists', { artifact, params });        // fire by name
checkHelp('ref-exists');                             // --help text by name
```

### `run(options)`

Every check takes one options object so that multi-artifact cross-checks stay
flexible:

| Option     | Type                                     | Required | Description                                                              |
| ---------- | ---------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `artifact` | `object`                                 | yes      | The primary JSON document to validate.                                    |
| `artifacts`| `Record<string, JSON object>`            | no       | Named secondary documents; cross-document checks read `artifacts.target`.|
| `basePath` | `string`                                 | no       | Base directory for file references inside parameters (e.g. `to.file`).    |
| `params`   | `Record<string, unknown>`                | no       | The check's parameters, per its manifest.                                 |

`run()` validates its inputs before executing: the artifact must be a JSON
object, every required parameter of the check must be present, and unknown
check names abort with the list of supported checks. Each violation throws an
`Error` naming the check and the problem.

### Findings

Every check returns `Finding[]`:

```ts
interface Finding {
  check: string;     // e.g. 'unique-ids'
  category: string;  // 'structural' | 'traceability' | 'ambiguity' | 'completeness'
  target: string;    // location in the artifact, e.g. 'items[].id'
  finding: string;   // human-readable problem description
  fix?: string;      // suggested remedy
}
```

### Path grammar

Parameters that address collections or text fields accept a
`segment([].segment)*` grammar over dot-separated names:

- `tasks` — the top-level `tasks` array.
- `epics[].features` — the `features` array inside every `epics` item.
- `sections[].notes` — the `notes` string inside every `sections` item.

Absent properties, empty arrays, and non-matching shapes resolve to nothing
and never error.

## CLI

The package ships a `checks` binary (`node src/cli.ts` from the package, or
`npx checks` once linked):

```sh
checks list                                  # all checks with descriptions
checks unique-ids --help                     # parameter documentation
checks unique-ids --artifact a.json \
  --params '{"arrays":["items"]}'            # fire one check
checks ref-exists --artifact a.json \
  --basePath /docs \
  --params '{"from":{"array":"tasks","field":"requires"},"to":{"file":"requirements.json","arrays":["requirements"],"field":"id"}}'
```

- `--artifact -` reads the artifact from stdin.
- `--params '<json>'` or `--params-file params.json` supply parameters.
- `--artifacts '{"target": {...}}'` supplies named secondary documents inline.
- Findings print as a JSON array. Exit codes: `0` no findings, `1` findings,
  `2` usage error, unknown check, or invalid JSON.

## Check reference

### unique-ids

Detects duplicate ids within each configured array and across declared union
scopes.

| Parameter  | Type                    | Required | Default | Description                                                                                                                  |
| ---------- | ----------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `arrays`   | `string[]`              | yes      | —       | Array selectors whose entries must carry unique ids; every addressed collection is validated in its own scope.                |
| `unions`   | `{ arrays: string[] }[]`| no       | `[]`    | Groups enforcing one uniqueness scope across the union of the listed collections; duplicates report every containing location.|
| `id_field` | `string`                | no       | `"id"`  | Entry property that holds the identifier.                                                                                     |

### ref-exists

Validates that every reference emitted by this artifact exists among the ids
of a target document. Target resolution order: `to.file` of `"."` meaning this
artifact, else the inline `artifacts.target` document, else the file
`to.file` read relative to `basePath`. An unreadable target file no-ops.

| Parameter | Type                                        | Required | Default | Description                                                                                                        |
| --------- | ------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `from`    | `{ array: string; field: string }`          | yes      | —       | The array of referencing entries and the field holding the reference value (string or list of strings per entry).   |
| `to`      | `{ file?: string; arrays: string[]; field: string }` | yes | —  | Optional target file, array selectors on the target document (path specs allowed), and the id field on those arrays.|

### ref-covers

The reverse of ref-exists: every id in the target document must appear at
least once among the reference values of this artifact (coverage, not dangling
references). Same target resolution order and params as ref-exists.

### duplicate-refs

Detects duplicate entries within each item's list field.

| Parameter    | Type     | Required | Default | Description                                                            |
| ------------ | -------- | -------- | ------- | ---------------------------------------------------------------------- |
| `array`      | `string` | yes      | —       | Array selector of the entries to inspect.                              |
| `list_field` | `string` | yes      | —       | Per-entry property holding the list scanned for duplicates.             |

### given-when-then

Requires every entry in the addressed collection(s) to contain Given, When,
and Then keywords in its statement field.

| Parameter         | Type                | Required | Default        | Description                                                     |
| ----------------- | ------------------- | -------- | -------------- | --------------------------------------------------------------- |
| `arrays`          | `string \| string[]`| yes      | —              | One selector or a list; the union of resolved collections is evaluated. |
| `statement_field` | `string`            | no       | `"statement"`  | Per-entry property holding the statement text to scan.          |

### forbidden-words

Scans configured text fields for forbidden words; the first match per value is
reported.

| Parameter   | Type                                                | Required | Default        | Description                                                        |
| ----------- | --------------------------------------------------- | -------- | -------------- | ------------------------------------------------------------------ |
| `fields`    | `(string \| { path: string; forbidden?: string[] })[]` | yes   | —              | Text fields to scan; object entries override the word list per field.|
| `forbidden` | `string[]`                                          | no       | shared profile | Replacement word list for every field without its own override.    |

### required-note-for-status

Requires entries whose status is one of the configured statuses to carry a
non-empty note.

| Parameter    | Type       | Required | Default                  | Description                                  |
| ------------ | ---------- | -------- | ------------------------ | -------------------------------------------- |
| `array`      | `string`   | yes      | —                        | Array selector of the entries to inspect.    |
| `statuses`   | `string[]` | yes      | —                        | Statuses that require a note.                |
| `note_field` | `string`   | no       | `"implementation_note"`   | Per-entry property holding the note.         |

### all-tasks-terminal

Requires every entry in the configured array to have one of the allowed
terminal statuses.

| Parameter          | Type       | Required | Default | Description                          |
| ------------------ | ---------- | -------- | ------- | ------------------------------------ |
| `array`            | `string`   | yes      | —       | Array selector that must be terminal.|
| `allowed_statuses` | `string[]` | yes      | —       | Terminal statuses.                   |

### dependency-acyclic

Requires the dependency graph over the configured array to contain no cycles.

| Parameter       | Type     | Required | Default        | Description                                       |
| --------------- | -------- | -------- | -------------- | ------------------------------------------------- |
| `array`         | `string` | yes      | —              | Array selector forming the dependency graph.      |
| `id_field`      | `string` | no       | `"id"`         | Entry property holding the identifier.            |
| `depends_field` | `string` | no       | `"depends_on"` | Entry property holding the list of dependency ids.|

### dependency-order

Requires that no entry depends on an entry appearing later in the array
(forward-dependency ordering). Same parameters as dependency-acyclic.

## Testing

```sh
npm test   # in packages/checks — node --test, 111 unit tests
```

The suite covers every check (violation and clean cases, defaults, custom
fields, path specs, cross-document variants, required-parameter aborts), the
registry and manifests (drift guards), the help renderer, JSON I/O, the CLI
including a stdin end-to-end run, and a guard that keeps the package free of
YAML imports and toolkit references.
