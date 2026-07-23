import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIdsCatalog } from '../../src/scripts/lib/policy-loader.mjs';
import { readYaml } from '../../src/scripts/lib/yaml-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

test('ids catalog patterns compile and match examples', () => {
  const ids = loadIdsCatalog(root);
  assert.ok(ids.prefixes.REQ);
  assert.ok(ids.prefixes.FR);
  assert.ok(ids.prefixes.TASK);
  assert.ok(ids.prefixes.DD);

  const examples = {
    REQ: 'REQ-001',
    FR: 'FR-001',
    NFR: 'NFR-001',
    AC: 'AC-001',
    DL: 'DL-001',
    DES: 'DES-001',
    CMP: 'CMP-001',
    DM: 'DM-001',
    API: 'API-001',
    DEC: 'DEC-001',
    PLAN: 'PLAN-001',
    TASK: 'TASK-001',
    DD: 'DD-00000001'
  };

  for (const [prefix, example] of Object.entries(examples)) {
    const pattern = ids.prefixes[prefix].pattern;
    const re = new RegExp(pattern);
    assert.ok(re.test(example), `${prefix} pattern should match ${example}`);
  }
});

test('ids catalog matches schema metadata patterns where applicable', () => {
  const ids = loadIdsCatalog(root);

  const reqSchema = readYaml(path.join(root, 'src/schemas/requirements.schema.yaml'));
  assert.equal(reqSchema.properties.metadata.properties.id.pattern, ids.prefixes.REQ.pattern);

  const designSchema = readYaml(path.join(root, 'src/schemas/design.schema.yaml'));
  assert.equal(designSchema.properties.metadata.properties.id.pattern, ids.prefixes.DES.pattern);

  const planSchema = readYaml(path.join(root, 'src/schemas/plan.schema.yaml'));
  assert.equal(planSchema.properties.metadata.properties.id.pattern, ids.prefixes.PLAN.pattern);
});
