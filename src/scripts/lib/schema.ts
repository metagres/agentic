import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readYaml } from './yaml-io.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

try {
  addFormats(ajv);
} catch {
  // ajv-formats is optional at runtime.
}

const compiledSchemas = new Map();

function resolveSchemaFile(schemaFile: string, cwd: string): string | null {
  const candidates = [
    // Bundled/deployed runtime:
    //   <agent-root>/sdlc/scripts/sdlc.js
    //   <agent-root>/sdlc/schemas/<schemaFile>
    path.resolve(scriptDir, '..', 'schemas', schemaFile),

    // Development runtime:
    //   src/scripts/lib/schema.ts
    //   src/schemas/<schemaFile>
    path.resolve(scriptDir, '..', '..', 'schemas', schemaFile),

    // Extra fallbacks.
    path.resolve(scriptDir, '..', '..', '..', 'schemas', schemaFile),
    path.join(cwd, 'schemas', schemaFile),
    path.join(cwd, 'src', 'schemas', schemaFile),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function loadSchema(schemaFile: string, cwd: string = process.cwd()): unknown {
  const abs = resolveSchemaFile(schemaFile, cwd);
  if (!abs) {
    throw new Error(`Schema not found: ${schemaFile}`);
  }

  if (!compiledSchemas.has(abs)) {
    const schema = readYaml(abs) as Record<string, unknown>;
    compiledSchemas.set(abs, ajv.compile(schema));
  }

  return compiledSchemas.get(abs);
}

export function validateWithSchema(data: unknown, schemaFile: string, cwd: string = process.cwd()): { check: string; severity: string; category: string; target: string; finding: string; fix: string }[] {
  try {
    const validate = loadSchema(schemaFile, cwd) as { (data: unknown): boolean; errors?: { instancePath?: string; message?: string }[] };
    const valid = validate(data);
    if (valid) {
      return [];
    }

    return (validate.errors || []).map((err) => {
      const target = err.instancePath || 'doc';
      return {
        check: 'schema',
        severity: 'blocking',
        category: 'structural',
        target,
        finding: `${target} ${err.message}`.trim(),
        fix: `Fix ${target} to match ${schemaFile}`,
      };
    });
  } catch (err: unknown) {
    return [
      {
        check: 'schema',
        severity: 'blocking',
        category: 'structural',
        target: 'doc',
        finding: err instanceof Error ? err.message : String(err),
        fix: `Ensure schema file exists and is valid: ${schemaFile}`,
      },
    ];
  }
}

export function validateArtifactSchema(target: string, data: unknown, cwd: string = process.cwd()): { check: string; severity: string; category: string; target: string; finding: string; fix: string }[] {
  const schemaByTarget = {
    requirements: 'requirements.schema.yaml',
    design: 'design.schema.yaml',
    plan: 'plan.schema.yaml',
    planning: 'plan.schema.yaml',
    implementation: 'plan.schema.yaml',
  };

  const schemaFile = schemaByTarget[target as keyof typeof schemaByTarget];
  if (!schemaFile) {
    return [];
  }

  return validateWithSchema(data, schemaFile, cwd);
}
