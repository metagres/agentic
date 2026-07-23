import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../../src/scripts/lib/yaml-io.mjs';
import { runChecks } from '../../src/scripts/lib/contract-checks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const contractsFixtureDir = path.join(root, 'test', 'contracts');

const manifest = readYaml(path.join(contractsFixtureDir, 'manifest.yaml'));

function makeCtx(caseDef) {
  return {
    loadFile(refFile) {
      const refFixture = caseDef.refs?.[refFile];
      if (!refFixture) return null;
      return readYaml(path.join(contractsFixtureDir, refFixture));
    },
    fileExists(refFile) {
      return Boolean(caseDef.refs?.[refFile]);
    },
    readFile() {
      return null;
    },
    changedFiles() {
      return [];
    },
  };
}

for (const caseDef of manifest.cases || []) {
  test(`contract fixture: ${caseDef.name}`, () => {
    const contractPath = path.join(
      root,
      'src',
      'contracts',
      `${caseDef.contract}-contract.yaml`
    );
    const artifactPath = path.join(contractsFixtureDir, caseDef.artifact);

    const contract = readYaml(contractPath);
    const artifact = readYaml(artifactPath);

    assert.ok(contract, `Unable to load contract: ${contractPath}`);
    assert.ok(artifact, `Unable to load artifact fixture: ${artifactPath}`);

    const findings = runChecks(artifact, contract, makeCtx(caseDef), {
      gate: caseDef.gate || 'review',
    });

    const blocking = findings
      .filter((finding) => finding.severity === 'blocking')
      .map((finding) => finding.check)
      .sort();

    if (Array.isArray(caseDef.expect?.blocking)) {
      const expected = [...caseDef.expect.blocking].sort();
      assert.deepEqual(
        blocking,
        expected,
        `Unexpected blocking findings:
${JSON.stringify(findings, null, 2)}`
      );
    }

    if (Array.isArray(caseDef.expect?.blocking_includes)) {
      for (const expectedCheck of caseDef.expect.blocking_includes) {
        assert.ok(
          blocking.includes(expectedCheck),
          `Expected blocking check '${expectedCheck}' not found.
Blocking checks: ${blocking.join(', ')}
Findings:
${JSON.stringify(findings, null, 2)}`
        );
      }
    }
  });
}
