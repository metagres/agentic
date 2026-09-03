import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { readYaml } from './yaml-io.ts';
import { getStageById, loadStageRegistry } from './stage-registry.ts';
import type { StageRecord } from './stage-registry.ts';
import { runStageChecks, CHECK_CATALOG } from './checks/index.ts';
import type { StructuralChecksDoc, PathParamSpec } from './checks/index.ts';
import { parsePathSpec } from './artifact-paths.ts';
import type { Finding } from './types.ts';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

try {
  addFormats(ajv);
} catch {
  // ajv-formats is optional at runtime.
}

const compiledSchemas = new Map<string, ReturnType<typeof ajv.compile>>();

function schemaFindings(schemaPath: string, data: unknown): Finding[] {
  let validate: ReturnType<typeof ajv.compile>;
  if (compiledSchemas.has(schemaPath)) {
    validate = compiledSchemas.get(schemaPath) as ReturnType<typeof ajv.compile>;
  } else {
    const schema = readYaml(schemaPath) as Record<string, unknown>;
    validate = ajv.compile(schema);
    compiledSchemas.set(schemaPath, validate);
  }

  const valid = validate(data);
  if (valid) return [];

  return (validate.errors || []).map((err) => {
    const target = err.instancePath || 'doc';
    return {
      check: 'schema',
      severity: 'blocking',
      category: 'structural',
      target,
      finding: `${target} ${err.message}`.trim(),
      fix: `Fix ${target} to match ${schemaPath.split('/').pop()}`,
    };
  });
}

/**
 * API-003 validateArtifact(stageId, artifact, cwd, changeRoot): the single
 * validation path (CMP-005, DEC-009). JSON Schema findings against the stage's
 * schema.yaml followed by the named checks from the stage's
 * structural-checks.yaml, concatenated in the frozen Finding shape. Used by
 * authoring --finalize, the review stages, and bin/lint-artifact.ts so internal
 * finalization and external review produce identical findings for the same
 * artifact content. Cross-artifact version equality checks are removed; the
 * based_on_* metadata fields remain as provenance only (DEC-010).
 *
 * Before the named checks run, the check declarations themselves are validated
 * (CMP-003, DEC-003): every [].-bearing parameter string must sit inside a
 * path-bearing parameter slot of its check and must resolve through the stage
 * schema. A malformed or unsupported path aborts with a thrown Error naming
 * the stage folder and the declaration.
 */
export function validateArtifact(
  stageId: string,
  artifact: Record<string, unknown> | null,
  cwd: string,
  changeRoot: string | null
): Finding[] {
  if (!artifact || typeof artifact !== 'object') return [];

  const stage = getStageById(cwd, stageId);
  if (!stage) return [];

  const findings: Finding[] = [];

  if (stage.files.schema) {
    findings.push(...schemaFindings(stage.files.schema, artifact));
  }

  if (stage.files.structuralChecks) {
    const checksDoc = readYaml(stage.files.structuralChecks) as StructuralChecksDoc;
    validateCheckDeclarations(stage, checksDoc, cwd);
    findings.push(
      ...runStageChecks(stage.id, stage.folder, artifact, { cwd, changeRoot }, checksDoc)
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Declaration path validation (CMP-003, DEC-003)
// ---------------------------------------------------------------------------

const declarationSchemas = new Map<string, Record<string, unknown>>();

function loadDeclarationSchema(schemaPath: string): Record<string, unknown> {
  const cached = declarationSchemas.get(schemaPath);
  if (cached) return cached;
  const schema = readYaml(schemaPath) as Record<string, unknown>;
  declarationSchemas.set(schemaPath, schema);
  return schema;
}

// Resolve a local draft-07 $ref (#/definitions/...) against the schema root.
// Non-local or unresolvable refs return the node unchanged.
function resolveLocalRef(
  root: Record<string, unknown>,
  node: unknown
): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return null;
  const record = node as Record<string, unknown>;
  const ref = record.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return record;

  let current: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (current === null || typeof current !== 'object') return record;
    current = (current as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) return record;
  return current as Record<string, unknown>;
}

function schemaTypes(node: Record<string, unknown>): string[] {
  const t = node.type;
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.map(String);
  return [];
}

// Collect the path strings a single pathParams slot addresses. A slot spec is
// a dot-path into params where a 'key[]' segment iterates a list; the reached
// value may be a string, a list of strings, or a list of objects carrying a
// 'path' key (the forbidden-words fields shape).
function collectSlotPaths(params: Record<string, unknown>, slot: string): string[] {
  let currents: unknown[] = [params];

  for (const part of slot.split('.')) {
    const iterate = part.endsWith('[]');
    const key = iterate ? part.slice(0, -2) : part;
    const next: unknown[] = [];

    for (const current of currents) {
      if (current === null || typeof current !== 'object') continue;
      const value = (current as Record<string, unknown>)[key];
      if (iterate) {
        if (Array.isArray(value)) next.push(...value);
      } else {
        next.push(value);
      }
    }

    currents = next;
  }

  const out: string[] = [];
  for (const value of currents) {
    if (typeof value === 'string') {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          out.push(entry);
        } else if (
          entry !== null &&
          typeof entry === 'object' &&
          typeof (entry as Record<string, unknown>).path === 'string'
        ) {
          out.push((entry as Record<string, unknown>).path as string);
        }
      }
    }
  }

  return out;
}

// Collect every string anywhere in a params subtree.
function collectAllStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectAllStrings(entry, out);
  } else if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectAllStrings(entry, out);
    }
  }
  return out;
}

// Grammar check for a [].-bearing selector: every intermediate segment must
// bear [] and the final segment must not (the grammar is segment([].segment)*).
function grammarError(spec: string): string | null {
  const segments = parsePathSpec(spec);
  if (segments.length < 2) {
    return `selector '${spec}' is malformed: a [].-bearing selector needs at least one [] iteration`;
  }
  for (let i = 0; i < segments.length; i++) {
    const isFinal = i === segments.length - 1;
    if (isFinal && segments[i].iterate) {
      return `selector '${spec}' is malformed: the final segment must not bear []`;
    }
    if (!isFinal && !segments[i].iterate) {
      return `selector '${spec}' is malformed: intermediate segment '${segments[i].name}' must bear []`;
    }
  }
  return null;
}

// Validate one [].-bearing selector against a stage schema: each segment must
// be a property declared at its nesting depth, a []-marked segment must be
// array-typed there, a collection selector must end at an array-typed
// property, and a leaf selector must end at a string-typed property.
function schemaPathError(
  root: Record<string, unknown>,
  spec: string,
  kind: 'collection' | 'leaf'
): string | null {
  const segments = parsePathSpec(spec);
  let node: Record<string, unknown> | null = root;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isFinal = i === segments.length - 1;

    const resolved = resolveLocalRef(root, node);
    if (!resolved) return `schema node for segment '${segment.name}' is not an object schema`;

    const properties = resolved.properties;
    if (
      properties === null ||
      typeof properties !== 'object' ||
      Array.isArray(properties) ||
      !(segment.name in (properties as Record<string, unknown>))
    ) {
      return `property '${segment.name}' is not declared in the schema at its nesting depth`;
    }

    const propSchema = resolveLocalRef(
      root,
      (properties as Record<string, unknown>)[segment.name]
    );
    if (!propSchema) {
      return `property '${segment.name}' has an invalid schema`;
    }

    const types = schemaTypes(propSchema);

    if (!isFinal || kind === 'collection') {
      if (!types.includes('array')) {
        return `property '${segment.name}' must be array-typed`;
      }
      if (!isFinal) {
        const items = propSchema.items;
        if (items === null || typeof items !== 'object' || Array.isArray(items)) {
          return `property '${segment.name}' does not declare array item schemas`;
        }
        node = items as Record<string, unknown>;
      }
    } else if (!types.includes('string')) {
      return `property '${segment.name}' must be string-typed`;
    }
  }

  return null;
}

// Find the stage record owning a target artifact file, for ref-exists to.file
// schema resolution through the stage registry.
function stageOwningArtifact(cwd: string, file: string): StageRecord | null {
  const registry = loadStageRegistry(cwd);
  return registry.find((stage) => stage.artifact === file) || null;
}

/**
 * Validates the check declarations of a stage folder (CMP-003, DEC-003):
 * every [].-bearing parameter string must sit inside a path-bearing parameter
 * slot of its check and must resolve through the governing stage schema —
 * the stage's own schema.yaml, or the schema of the stage owning a ref-exists
 * to.file target; a file no stage owns falls back to grammar checks only.
 * Violations abort with a thrown Error naming the stage folder and the
 * declaration, mirroring the unknown-check abort. No new errors.yaml codes.
 */
export function validateCheckDeclarations(
  stage: StageRecord,
  checksDoc: StructuralChecksDoc | null,
  cwd: string
): void {
  if (!checksDoc || !Array.isArray(checksDoc.checks)) return;

  const ownSchema = stage.files.schema
    ? loadDeclarationSchema(stage.files.schema)
    : null;

  for (const entry of checksDoc.checks) {
    const name = entry?.check;
    const spec = typeof name === 'string' ? CHECK_CATALOG[name] : undefined;
    if (!spec) continue; // unknown checks abort in runStageChecks

    const params = entry.params && typeof entry.params === 'object'
      ? (entry.params as Record<string, unknown>)
      : {};

    const pathParams: PathParamSpec[] = spec.pathParams || [];
    const declared: { path: string; kind: 'collection' | 'leaf' }[] = [];
    for (const slot of pathParams) {
      for (const path of collectSlotPaths(params, slot.spec)) {
        declared.push({ path, kind: slot.kind });
      }
    }

    // A [].-bearing string anywhere outside the declared slots aborts as an
    // unsupported path.
    const declaredPaths = new Set(declared.map((d) => d.path));
    for (const str of collectAllStrings(params)) {
      if (str.includes('[]') && !declaredPaths.has(str)) {
        throw new Error(
          `Stage '${stage.id}' (${stage.folder}) check '${name}' declares unsupported path '${str}': path-bearing parameters are ${pathParams.map((p) => p.spec).join(', ') || 'none'}.`
        );
      }
    }

    // Grammar and schema validation for each declared [].-bearing selector.
    for (const { path, kind } of declared) {
      if (!path.includes('[]')) continue;

      const grammar = grammarError(path);
      if (grammar) {
        throw new Error(
          `Stage '${stage.id}' (${stage.folder}) check '${name}' declares an invalid path: ${grammar}.`
        );
      }

      // ref-exists to.file targets validate against the owning stage's schema;
      // a file no stage owns falls back to grammar checks only.
      let schema = ownSchema;
      if (name === 'ref-exists') {
        const to = (params.to && typeof params.to === 'object' ? params.to : {}) as {
          file?: unknown;
        };
        const toFile = typeof to.file === 'string' && to.file !== '.' ? to.file : null;
        if (toFile) {
          const owner = stageOwningArtifact(cwd, toFile);
          schema = owner?.files.schema ? loadDeclarationSchema(owner.files.schema) : null;
        }
      }

      if (!schema) continue;

      const schemaError = schemaPathError(schema, path, declared.find((d) => d.path === path)?.kind || 'collection');
      if (schemaError) {
        throw new Error(
          `Stage '${stage.id}' (${stage.folder}) check '${name}' declares an invalid path: ${schemaError}.`
        );
      }
    }
  }
}
