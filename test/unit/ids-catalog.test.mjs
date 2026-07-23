import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIdsCatalog } from '../../src/scripts/lib/policy-loader.mjs';
import { readYaml } from '../../src/scripts/lib/yaml-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

/**
 * Normalize a regex pattern string so that \d and [0-9] are treated
 * as equivalent.  We canonicalise everything to [0-9].
 */
function normalizePattern(p) {
  return String(p).replace(/\\d/g, '[0-9]');
}

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
    DD: 'DD-00000001',
  };

  for (const [prefix, example] of Object.entries(examples)) {
    const pattern = ids.prefixes[prefix].pattern;
    const re = new RegExp(pattern);
    assert.ok(re.test(example), `${prefix} pattern should match ${example}`);
  }
});

test('ids catalog matches schema metadata patterns where applicable', () => {
  const ids = loadIdsCatalog(root);
  const reqSchema = readYaml(
    path.join(root, 'src/schemas/requirements.schema.yaml')
  );
  assert.equal(
    reqSchema.properties.metadata.properties.id.pattern,
    ids.prefixes.REQ.pattern
  );

  const designSchema = readYaml(
    path.join(root, 'src/schemas/design.schema.yaml')
  );
  assert.equal(
    designSchema.properties.metadata.properties.id.pattern,
    ids.prefixes.DES.pattern
  );

  const planSchema = readYaml(path.join(root, 'src/schemas/plan.schema.yaml'));
  assert.equal(
    planSchema.properties.metadata.properties.id.pattern,
    ids.prefixes.PLAN.pattern
  );
});

test('ids catalog is consistent with contract patterns', () => {
  const ids = loadIdsCatalog(root);
  const contractsDir = path.join(root, 'src', 'contracts');
  const contractFiles = fs
    .readdirSync(contractsDir)
    .filter((f) => f.endsWith('.yaml'));

  // Collect every regex pattern string that appears in contract files.
  const contractPatterns = new Set();
  for (const file of contractFiles) {
    const raw = fs.readFileSync(path.join(contractsDir, file), 'utf8');
    // Match single-quoted YAML regex patterns like '^FR-\d{3}$'
    const matches = raw.matchAll(/'(\^[^']+\$)'/g);
    for (const m of matches) {
      contractPatterns.add(normalizePattern(m[1]));
    }
  }

  // Every ids.yaml pattern that has a corresponding contract check
  // must appear (in normalised form) in the contract files.
  const prefixesInContracts = ['FR', 'NFR', 'AC', 'DL', 'CMP', 'DM', 'API', 'DEC', 'TASK'];

  for (const prefix of prefixesInContracts) {
    const idsPattern = normalizePattern(ids.prefixes[prefix].pattern);
    assert.ok(
      contractPatterns.has(idsPattern),
      `contract patterns should include ${idsPattern} (prefix ${prefix})`
    );
  }
});