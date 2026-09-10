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

  assert.equal(json.command, 'requirements-review');
  assert.equal(json.state, 'ok');
});

test('requirements-review requires --change', () => {
  const res = runCli(['requirements-review']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.command, 'requirements-review');
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

  assert.equal(json.command, 'requirements-review');
  assert.equal(json.state, 'blocked');
  assert.equal(json.data.target, 'requirements');
});

test('implementation --help returns ok state', () => {
  const res = runCli(['implementation', '--help']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.command, 'implementation');
  assert.equal(json.state, 'ok');
});

test('implementation requires --change', () => {
  const res = runCli(['implementation']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.command, 'implementation');
  assert.equal(json.state, 'blocked');
});

test('knowledge-extraction --help returns ok state', () => {
  const res = runCli(['knowledge-extraction', '--help']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.command, 'knowledge-extraction');
  assert.equal(json.state, 'ok');
});

test('docs alias resolves to knowledge-extraction', () => {
  const res = runCli(['docs', '--help']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.command, 'knowledge-extraction');
  assert.equal(json.state, 'ok');
});

test('the dedicated review command no longer exists', () => {
  const res = runCli(['review']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.command, 'review');
  assert.equal(json.state, 'blocked');
  assert.ok(json.errors.some((e) => e.code === 'UNKNOWN_COMMAND'));
});

test('docs-init is removed and returns UNKNOWN_COMMAND', () => {
  const res = runCli(['docs-init']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.command, 'docs-init');
  assert.equal(json.state, 'blocked');
  assert.ok(json.errors.some((e) => e.code === 'UNKNOWN_COMMAND'));
});

test('the command list omits docs-init', () => {
  const res = runCli(['--list-commands']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);
  const ids = json.data.commands.map((w) => w.id);

  assert.ok(!ids.includes('docs-init'), `docs-init must not be listed: ${ids.join(', ')}`);
});

test('changes lists the slim per-change shape (name, stage, agent, suggested_command, open_feedback)', () => {
  const tmp = makeTmpProject();

  const req = runCli(['requirements', '--cwd', tmp, '--request', 'Add login']);
  assert.equal(req.status, 0, req.stderr);
  const changeDir = path.basename(JSON.parse(req.stdout).data.change_root);

  const res = runCli(['changes', '--cwd', tmp]);
  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);
  assert.equal(json.command, 'changes');
  assert.equal(json.state, 'ok');

  const entry = json.data.changes.find((c) => c.change_name === changeDir);
  assert.ok(entry, JSON.stringify(json.data));

  // Exactly the slim fields — no per-stage pipeline map. The stage is the
  // first non-settled stage in pipeline order (the tracked design artifact of
  // design-review is missing in a fresh change).
  assert.deepEqual(Object.keys(entry).sort(), [
    'agent',
    'change_name',
    'open_feedback',
    'stage',
    'suggested_command',
  ]);
  assert.equal(entry.stage, 'design-review');
  assert.equal(entry.agent, 'stage-reviewer');
  assert.equal(entry.suggested_command, `sdlc design-review --change ${changeDir}`);
  assert.equal(entry.open_feedback, null);
});
