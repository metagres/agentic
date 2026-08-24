#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readYaml } from '../src/scripts/lib/yaml-io.ts';
import { loadStageRegistry, getStageById } from '../src/scripts/lib/stage-registry.ts';
import { CHECK_CATALOG } from '../src/scripts/lib/checks/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policiesDir = path.join(root, 'src', 'policies');
const stagesDir = path.join(root, 'src', 'stages');

const results: { file: string; ok: boolean; error?: string }[] = [];
let failed = false;

function check(file: string, fn: (doc: unknown) => void) {
  const filePath = path.join(policiesDir, file);
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing policy file: ${filePath}`);
    }
    const doc = readYaml(filePath);
    fn(doc);
    results.push({ file, ok: true });
  } catch (err: unknown) {
    failed = true;
    results.push({ file, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

check('errors.yaml', (doc: unknown) => {
  const d = doc as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') throw new Error('errors.yaml must be an object');
  const errors = d.errors as Record<string, unknown> | undefined;
  if (!errors || typeof errors !== 'object') throw new Error('errors.yaml must define errors');
  for (const [code, def] of Object.entries(errors)) {
    const entry = def as Record<string, unknown> | null;
    if (!entry || typeof entry.message !== 'string') {
      throw new Error(`errors.yaml entry '${code}' must define message`);
    }
  }
});

// Stage folder validation: every stage.yaml descriptor must validate against
// the stage meta-schema, structural-checks declarations must resolve against
// the capped catalog, and steps.yaml must be well-formed.
const ajv = new Ajv({ allErrors: true, strict: false });
try {
  addFormats(ajv);
} catch {
  // Optional.
}

const metaSchema = readYaml(path.join(root, 'src', 'schemas', 'stage.schema.yaml')) as Record<string, unknown>;
const compileDescriptor = ajv.compile(metaSchema);

if (!fs.existsSync(stagesDir)) {
  console.error(`Missing stages directory: ${stagesDir}`);
  process.exit(1);
}

for (const stageName of fs.readdirSync(stagesDir).sort()) {
  const folder = path.join(stagesDir, stageName);
  if (!fs.statSync(folder).isDirectory()) continue;

  // stage.yaml descriptor against the meta-schema.
  const descriptorPath = path.join(folder, 'stage.yaml');
  try {
    if (!fs.existsSync(descriptorPath)) {
      throw new Error(`missing stage.yaml`);
    }
    const descriptor = readYaml(descriptorPath) as Record<string, unknown>;
    const valid = compileDescriptor(descriptor);
    if (!valid) {
      throw new Error(
        `stage.yaml fails the meta-schema: ${(compileDescriptor.errors || [])
          .map((e) => `${e.instancePath} ${e.message}`)
          .join('; ')}`
      );
    }
    results.push({ file: `stages/${stageName}/stage.yaml`, ok: true });
  } catch (err: unknown) {
    failed = true;
    results.push({
      file: `stages/${stageName}/stage.yaml`,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // structural-checks.yaml declarations against the capped catalog.
  const checksPath = path.join(folder, 'structural-checks.yaml');
  if (fs.existsSync(checksPath)) {
    try {
      const doc = readYaml(checksPath) as { checks?: { check?: string; params?: unknown }[] } | null;
      if (!doc || !Array.isArray(doc.checks)) {
        throw new Error('structural-checks.yaml must define a checks list');
      }
      for (const entry of doc.checks) {
        const name = entry?.check;
        if (typeof name !== 'string' || !CHECK_CATALOG[name]) {
          throw new Error(`unknown check '${String(name)}'`);
        }
        const params = entry.params && typeof entry.params === 'object'
          ? (entry.params as Record<string, unknown>)
          : {};
        const missing = CHECK_CATALOG[name].requiredParams.filter((p) => params[p] === undefined);
        if (missing.length > 0) {
          throw new Error(`check '${name}' missing parameter(s): ${missing.join(', ')}`);
        }
      }
      results.push({ file: `stages/${stageName}/structural-checks.yaml`, ok: true });
    } catch (err: unknown) {
      failed = true;
      results.push({
        file: `stages/${stageName}/structural-checks.yaml`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // steps.yaml shape.
  const stepsPath = path.join(folder, 'steps.yaml');
  if (fs.existsSync(stepsPath)) {
    try {
      const doc = readYaml(stepsPath) as { steps?: Record<string, unknown> } | null;
      if (!doc || typeof doc.steps !== 'object' || doc.steps === null) {
        throw new Error('steps.yaml must define a steps map');
      }
      results.push({ file: `stages/${stageName}/steps.yaml`, ok: true });
    } catch (err: unknown) {
      failed = true;
      results.push({
        file: `stages/${stageName}/steps.yaml`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // schema.yaml must compile as a JSON schema.
  const schemaPath = path.join(folder, 'schema.yaml');
  if (fs.existsSync(schemaPath)) {
    try {
      const schema = readYaml(schemaPath) as Record<string, unknown>;
      ajv.compile(schema);
      results.push({ file: `stages/${stageName}/schema.yaml`, ok: true });
    } catch (err: unknown) {
      failed = true;
      results.push({
        file: `stages/${stageName}/schema.yaml`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Requires graph must be a valid DAG with no missing references.
try {
  const registry = loadStageRegistry(root);
  const ids = new Set(registry.map((s) => s.id));
  for (const stage of registry) {
    for (const req of stage.requires) {
      if (!ids.has(req)) {
        throw new Error(`stage '${stage.id}' requires unknown stage '${req}'`);
      }
    }
  }
  results.push({ file: 'requires-graph', ok: true });
} catch (err: unknown) {
  failed = true;
  results.push({
    file: 'requires-graph',
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
}

// The registry must resolve every stage the runtime expects.
for (const expected of ['requirements', 'design', 'planning', 'implementation', 'knowledge-extraction']) {
  if (!getStageById(root, expected)) {
    failed = true;
    results.push({ file: `stage/${expected}`, ok: false, error: 'not discovered' });
  }
}

console.log(
  JSON.stringify(
    {
      ok: !failed,
      policies: results,
    },
    null,
    2
  )
);

process.exit(failed ? 1 : 0);
