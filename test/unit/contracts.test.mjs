import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../../src/scripts/lib/yaml-io.mjs';
import { validateContract } from '../../src/scripts/lib/contract-checks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(__dirname, '../../src/contracts');

const contractFiles = [
  'requirements-contract.yaml',
  'design-contract.yaml',
  'plan-contract.yaml',
];

for (const file of contractFiles) {
  test(`contract ${file} is valid`, () => {
    const contract = readYaml(path.join(contractsDir, file));

    assert.ok(contract, `Unable to load ${file}`);
    assert.ok(Array.isArray(contract.checks), `${file} must define checks[]`);
    assert.ok(
      Array.isArray(contract.semantic_checks),
      `${file} must define semantic_checks[]`
    );

    assert.doesNotThrow(() => validateContract(contract));
  });
}
