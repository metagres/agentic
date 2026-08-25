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

test('requirements-review requires --change', () => {
  const res = runCli(['requirements-review']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'requirements-review');
  assert.equal(json.state, 'blocked');
});

test('requirements-review reports missing change', () => {
  const tmp = makeTmpProject();

  const res = runCli([
    'requirements-review',
    '--change',
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

test('implementation requires --change', () => {
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

test('docs-init is removed and returns UNKNOWN_COMMAND', () => {
  const res = runCli(['docs-init']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'docs-init');
  assert.equal(json.state, 'blocked');
  assert.ok(json.errors.some((e) => e.code === 'UNKNOWN_COMMAND'));
});

test('the workflow list omits docs-init', () => {
  const res = runCli(['--list-workflows']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);
  const ids = json.data.workflows.map((w) => w.id);

  assert.ok(!ids.includes('docs-init'), `docs-init must not be listed: ${ids.join(', ')}`);
});
