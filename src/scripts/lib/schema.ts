import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readYaml } from './yaml-io.ts';
import { resolveRuntimeFile } from './paths.ts';

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

export function loadSchema(schemaFile: string, cwd: string = process.cwd()): unknown {
  const abs = resolveRuntimeFile('schemas', schemaFile, cwd);
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
