import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { readYaml } from './yaml-io.ts';
import { getStageById } from './stage-registry.ts';
import { runStageChecks } from './checks/index.ts';
import type { StructuralChecksDoc } from './checks/index.ts';
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
    findings.push(
      ...runStageChecks(stage.id, stage.folder, artifact, { cwd, changeRoot }, checksDoc)
    );
  }

  return findings;
}
