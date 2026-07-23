import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '../../src/scripts/sdlc.mjs');

function makeTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-authoring-'));
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  });
}

test('requirements --request creates change and enters discovery', () => {
  const tmp = makeTmpProject();

  const res = runCli([
    'requirements',
    '--cwd',
    tmp,
    '--request',
    'Add login',
  ]);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'requirements');
  assert.equal(json.step, 'discovery');
  assert.ok(json.data.change_root);

  const artifactPath = path.join(
    json.data.change_root,
    'requirements.yaml'
  );

  assert.ok(fs.existsSync(artifactPath));
});

test('planning enters init when design is missing', () => {
  const tmp = makeTmpProject();

  const req = runCli([
    'requirements',
    '--cwd',
    tmp,
    '--request',
    'Add login',
  ]);

  assert.equal(req.status, 0, req.stderr);

  const reqJson = JSON.parse(req.stdout);
  const changeDir = path.basename(reqJson.data.change_root);

  const plan = runCli([
    'planning',
    '--cwd',
    tmp,
    '--dir',
    changeDir,
  ]);

  assert.equal(plan.status, 0, plan.stderr);

  const planJson = JSON.parse(plan.stdout);

  assert.equal(planJson.workflow, 'planning');
  assert.equal(planJson.step, 'init');
  assert.equal(planJson.data.based_on_design, null);
});
