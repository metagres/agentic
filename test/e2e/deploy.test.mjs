import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateWithSchema } from '../../src/scripts/lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const deployScript = path.join(root, 'bin', 'deploy-to-agent.mjs');

test('deploy bundle smoke test', { timeout: 240000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-deploy-smoke-'));
  const dest = path.join(tmp, '.agent');

  const deploy = spawnSync(
    process.execPath,
    [deployScript, '--dest', dest, '--project-root', tmp, '--bundle', '--clean'],
    { encoding: 'utf8' }
  );

  assert.equal(deploy.status, 0, deploy.stderr);
  const deployStdout = deploy.stdout.trim();
  const deployJsonStart = deployStdout.lastIndexOf('\n{');
  const deployJson = JSON.parse(
    deployJsonStart === -1 ? deployStdout : deployStdout.slice(deployJsonStart + 1)
  );
  assert.equal(deployJson.ok, true);

  const expectedSchemas = [
    'requirements.schema.yaml',
    'design.schema.yaml',
    'plan.schema.yaml',
    'docs-delta.schema.yaml',
    'cli-envelope.schema.yaml'
  ];

  for (const file of expectedSchemas) {
    assert.ok(
      fs.existsSync(path.join(dest, 'sdlc', 'schemas', file)),
      `missing deployed schema: ${file}`
    );
  }

  const expectedPolicies = [
    'pipeline.yaml',
    'review-targets.yaml',
    'lifecycle.yaml',
    'requirements-policy.yaml',
    'semantic-policy.yaml'
  ];

  for (const file of expectedPolicies) {
    assert.ok(
      fs.existsSync(path.join(dest, 'sdlc', 'policies', file)),
      `missing deployed policy: ${file}`
    );
  }

  const expectedContracts = [
'requirements-contract.yaml',
'design-contract.yaml',
'plan-contract.yaml',
'implementation-contract.yaml'
];
for (const file of expectedContracts) {
assert.ok(
fs.existsSync(path.join(dest, 'sdlc', 'contracts', file)),
`missing deployed contract: ${file}`
);
}

const expectedTemplates = [
'requirements.yaml',
'design.yaml',
'plan.yaml',
'docs-current-index.md'
];
for (const file of expectedTemplates) {
assert.ok(
fs.existsSync(path.join(dest, 'sdlc', 'templates', file)),
`missing deployed template: ${file}`
);
}

assert.ok(
fs.existsSync(path.join(dest, 'sdlc', 'manifest.json')),
'missing deployed manifest'
);
assert.ok(
fs.existsSync(path.join(dest, 'sdlc', 'scripts', 'sdlc.mjs')),
'missing runtime CLI'
);
assert.ok(
fs.existsSync(path.join(dest, 'skills', 'requirements-authoring', 'SKILL.md')),
'missing generated skills'
);

  const cliPath = path.join(dest, 'sdlc', 'scripts', 'sdlc.mjs');
  const cli = spawnSync(process.execPath, [cliPath, '--list-workflows'], {
    encoding: 'utf8',
    cwd: tmp
  });

  assert.equal(cli.status, 0, cli.stderr);
  const json = JSON.parse(cli.stdout);
  const findings = validateWithSchema(json, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});
