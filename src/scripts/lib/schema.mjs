import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readYaml } from './yaml-io.mjs';

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

function resolveSchemaFile(schemaFile, cwd) {
  const candidates = [
    // Bundled/deployed runtime:
    //   <agent-root>/sdlc/scripts/sdlc.mjs
    //   <agent-root>/sdlc/schemas/<schemaFile>
    path.resolve(scriptDir, '..', 'schemas', schemaFile),

    // Development runtime:
    //   src/scripts/lib/schema.mjs
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

export function loadSchema(schemaFile, cwd = process.cwd()) {
  const abs = resolveSchemaFile(schemaFile, cwd);
  if (!abs) {
    throw new Error(`Schema not found: ${schemaFile}`);
  }

  if (!compiledSchemas.has(abs)) {
    const schema = readYaml(abs);
    compiledSchemas.set(abs, ajv.compile(schema));
  }

  return compiledSchemas.get(abs);
}

export function validateWithSchema(data, schemaFile, cwd = process.cwd()) {
  try {
    const validate = loadSchema(schemaFile, cwd);
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
  } catch (err) {
    return [
      {
        check: 'schema',
        severity: 'blocking',
        category: 'structural',
        target: 'doc',
        finding: err.message,
        fix: `Ensure schema file exists and is valid: ${schemaFile}`,
      },
    ];
  }
}

export function validateArtifactSchema(target, data, cwd = process.cwd()) {
  const schemaByTarget = {
    requirements: 'requirements.schema.yaml',
    design: 'design.schema.yaml',
    plan: 'plan.schema.yaml',
    planning: 'plan.schema.yaml',
    implementation: 'plan.schema.yaml',
  };

  const schemaFile = schemaByTarget[target];
  if (!schemaFile) {
    return [];
  }

  return validateWithSchema(data, schemaFile, cwd);
}
