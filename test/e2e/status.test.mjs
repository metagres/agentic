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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-status-'));
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  });
}

test('--version returns version', () => {
  const res = runCli(['--version']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'cli');
  assert.equal(json.state, 'ok');
  assert.ok(json.data.version);
});

test('status reports requirements as current for a new change', () => {
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

  const res = runCli([
    'status',
    '--cwd',
    tmp,
    '--dir',
    changeDir,
  ]);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'status');
  assert.equal(json.data.current_workflow, 'requirements');
  assert.equal(json.data.pipeline.requirements, 'draft');
  assert.ok(json.data.suggested_command.includes('requirements'));
});
