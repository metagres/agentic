import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '../../src/scripts/sdlc.ts');

function makeTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-workflows-'));
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  });
}

test('requirements-review --help returns ok state', () => {
  const res = runCli(['requirements-review', '--help']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'requirements-review');
  assert.equal(json.state, 'ok');
});

test('requirements-review requires --dir', () => {
  const res = runCli(['requirements-review']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'requirements-review');
  assert.equal(json.state, 'blocked');
});

test('requirements-review reports missing change directory', () => {
  const tmp = makeTmpProject();

  const res = runCli([
    'requirements-review',
    '--dir',
    'missing-change',
    '--cwd',
    tmp,
  ]);

  assert.equal(res.status, 3);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'requirements-review');
  assert.equal(json.state, 'blocked');
  assert.equal(json.data.target, 'requirements');
});

test('implementation --help returns ok state', () => {
  const res = runCli(['implementation', '--help']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'implementation');
  assert.equal(json.state, 'ok');
});

test('implementation requires --dir', () => {
  const res = runCli(['implementation']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'implementation');
  assert.equal(json.state, 'blocked');
});

test('knowledge-extraction --help returns ok state', () => {
  const res = runCli(['knowledge-extraction', '--help']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'knowledge-extraction');
  assert.equal(json.state, 'ok');
});

test('docs alias resolves to knowledge-extraction', () => {
  const res = runCli(['docs', '--help']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'knowledge-extraction');
  assert.equal(json.state, 'ok');
});

test('the dedicated review command no longer exists', () => {
  const res = runCli(['review']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'review');
  assert.equal(json.state, 'blocked');
  assert.ok(json.errors.some((e) => e.code === 'UNKNOWN_COMMAND'));
});
