import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateWithSchema } from '../../src/scripts/lib/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const deployScript = path.join(root, 'bin', 'deploy-to-agent.ts');

test('deploy bundle smoke test', { timeout: 240000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-deploy-smoke-'));
  const dest = path.join(tmp, '.agent');

  const deploy = spawnSync(
    process.execPath,
    [deployScript, '--dest', dest, '--clean'],
    { encoding: 'utf8' }
  );

  assert.equal(deploy.status, 0, deploy.stderr);
  const deployStdout = deploy.stdout.trim();
  const deployJsonStart = deployStdout.lastIndexOf('\n{');
  const deployJson = JSON.parse(
    deployJsonStart === -1 ? deployStdout : deployStdout.slice(deployJsonStart + 1)
  );
  assert.equal(deployJson.ok, true);

  const skillDir = path.join(dest, 'skills', 'agentic-sdlc');

  assert.ok(
    fs.existsSync(path.join(skillDir, 'SKILL.md')),
    'missing generated SKILL.md'
  );
  assert.ok(
    fs.existsSync(path.join(skillDir, 'scripts', 'sdlc.js')),
    'missing bundled CLI'
  );
  assert.ok(
    fs.existsSync(path.join(skillDir, 'manifest.json')),
    'missing deployed manifest'
  );

  const expectedSchemas = [
    'stage.schema.yaml',
    'docs-delta.schema.yaml',
    'cli-envelope.schema.yaml'
  ];

  for (const file of expectedSchemas) {
    assert.ok(
      fs.existsSync(path.join(skillDir, 'schemas', file)),
      `missing deployed schema: ${file}`
    );
  }

  const expectedPolicies = [
    'errors.yaml'
  ];

  for (const file of expectedPolicies) {
    assert.ok(
      fs.existsSync(path.join(skillDir, 'policies', file)),
      `missing deployed policy: ${file}`
    );
  }

  const expectedTemplates = [
    'docs-current-index.md'
  ];
  for (const file of expectedTemplates) {
    assert.ok(
      fs.existsSync(path.join(skillDir, 'templates', file)),
      `missing deployed template: ${file}`
    );
  }

  // Every stage folder is bundled (NFR-002), and the bundle contains no
  // source TypeScript files (build-artifact invariant). Expectations derive
  // from the stages directory rather than a hardcoded enumeration.
  const sourceStages = fs
    .readdirSync(path.join(root, 'src', 'stages'))
    .filter((entry) => fs.statSync(path.join(root, 'src', 'stages', entry)).isDirectory());

  for (const stage of sourceStages) {
    assert.ok(
      fs.existsSync(path.join(skillDir, 'stages', stage, 'stage.yaml')),
      `missing deployed stage folder: ${stage}`
    );
  }

  assert.ok(
    !fs.existsSync(path.join(skillDir, 'stages', 'requirements', 'hooks.ts')),
    'stage hooks must be compiled, not bundled as source TypeScript'
  );
  assert.ok(
    fs.existsSync(path.join(skillDir, 'stages', 'requirements', 'hooks.js')),
    'compiled stage hooks.js must be present'
  );

  // No source TypeScript anywhere inside the bundle.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const abs = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(abs) : [abs];
    });
  const allFiles = walk(skillDir);
  assert.ok(
    !allFiles.some((f) => f.endsWith('.ts')),
    'deployed skill must not contain source TypeScript files'
  );

  assert.ok(
    !fs.existsSync(path.join(skillDir, 'package.json')),
    'deployed skill must not contain package.json'
  );
  assert.ok(
    !fs.existsSync(path.join(skillDir, 'node_modules')),
    'deployed skill must not contain node_modules'
  );

  const cli = spawnSync(
    process.execPath,
    [path.join(skillDir, 'scripts', 'sdlc.js'), '--list-workflows'],
    {
      encoding: 'utf8',
      cwd: dest
    }
  );

  assert.equal(cli.status, 0, cli.stderr);
  const json = JSON.parse(cli.stdout);
  const findings = validateWithSchema(json, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});
