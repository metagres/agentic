/** One deterministic result produced by a check run. */
export interface Finding {
  /** Name of the check that produced the finding. */
  check: string;
  /** Coarse problem class, for example 'structural', 'traceability', 'ambiguity' or 'completeness'. */
  category: string;
  /** Location the finding applies to, usually a path into the artifact. */
  target: string;
  /** Human-readable description of the problem. */
  finding: string;
  /** Optional suggested remedy. */
  fix?: string;
}

/** Documents and settings a check implementation receives after validation. */
export interface CheckInputs {
  /** The primary JSON document under validation. */
  artifact: Record<string, unknown>;
  /** Named secondary JSON documents for cross-document checks. */
  artifacts: Record<string, Record<string, unknown>>;
  /** The check's own parameters, per its manifest. */
  params: Record<string, unknown>;
  /** Base directory used to resolve file references inside parameters. */
  basePath?: string;
}

/** The pure implementation of one check. */
export type CheckImpl = (inputs: CheckInputs) => Finding[];

/** What a caller passes to fire a check. */
export interface RunOptions {
  /** The primary JSON document to validate. Required. */
  artifact: Record<string, unknown>;
  /** Named secondary JSON documents, for example `{ target: {...} }` for cross-document checks. */
  artifacts?: Record<string, Record<string, unknown>>;
  /** Base directory used to resolve file references inside parameters. */
  basePath?: string;
  /** The check's parameters, per its manifest. */
  params?: Record<string, unknown>;
}

/** Documentation of one parameter of a check. */
export interface ParamSpec {
  /** Parameter name as it appears in `params`. */
  name: string;
  /** Free-form type label, for example 'string', 'string[]', '{ array: string; field: string }'. */
  type: string;
  /** Whether `run()` refuses to execute without this parameter. */
  required: boolean;
  /** What the parameter controls. */
  description: string;
  /** Value used when the parameter is omitted. Absent for required parameters. */
  default?: unknown;
}

/** Self-describing documentation of one check. */
export interface CheckManifest {
  /** Registry key and finding `check` value of this check. */
  name: string;
  /** One-line description of what the check validates. */
  description: string;
  /** Parameter documentation rendered by `--help`. */
  params: ParamSpec[];
}

/** One registry entry: documentation plus the ability to fire the check. */
export interface CheckEntry {
  /** Structured parameter documentation. */
  manifest: CheckManifest;
  /**
   * Fires the check. Validates `options` and the required parameters against
   * the manifest, then runs the implementation. Synchronous.
   */
  run(options: RunOptions): Finding[];
  /** Human-readable parameter documentation, the same text the CLI prints for `--help`. */
  help(): string;
}
