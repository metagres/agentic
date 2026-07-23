import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../../src/scripts/lib/yaml-io.mjs';
import { validateArtifactSchema } from '../../src/scripts/lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const fixtures = path.join(root, 'test', 'contracts');

test('valid contract fixtures pass schema validation', () => {
  const req = readYaml(path.join(fixtures, 'requirements/valid.yaml'));
  assert.deepEqual(validateArtifactSchema('requirements', req, root), []);

  const design = readYaml(path.join(fixtures, 'design/valid.yaml'));
  assert.deepEqual(validateArtifactSchema('design', design, root), []);

  const plan = readYaml(path.join(fixtures, 'plan/valid.yaml'));
  assert.deepEqual(validateArtifactSchema('plan', plan, root), []);

  const impl = readYaml(path.join(fixtures, 'implementation/valid.yaml'));
  assert.deepEqual(validateArtifactSchema('implementation', impl, root), []);
});

test('structural schema violations are detected', () => {
  const req = readYaml(path.join(fixtures, 'requirements/valid.yaml'));
  const invalid = { ...req, unknown_top_level: true };
  assert.ok(validateArtifactSchema('requirements', invalid, root).length > 0);

  const invalidId = JSON.parse(JSON.stringify(req));
  invalidId.metadata.id = 'BAD';
  assert.ok(validateArtifactSchema('requirements', invalidId, root).length > 0);
});
