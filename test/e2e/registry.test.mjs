import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '../../src/scripts/sdlc.mjs');

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  });
}

test('--list-workflows lists all workflows', () => {
  const res = runCli(['--list-workflows']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'cli');
  assert.equal(json.state, 'ok');

  const ids = json.data.workflows.map((w) => w.id);

  assert.ok(ids.includes('requirements'));
  assert.ok(ids.includes('design'));
  assert.ok(ids.includes('planning'));
  assert.ok(ids.includes('implementation'));
  assert.ok(ids.includes('review'));
  assert.ok(ids.includes('knowledge-extraction'));
});

test('unknown command returns blocked state', () => {
  const res = runCli(['not-a-workflow']);

  assert.equal(res.status, 2);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'not-a-workflow');
  assert.equal(json.state, 'blocked');
});

test('--help returns ok state', () => {
  const res = runCli(['--help']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'cli');
  assert.equal(json.state, 'ok');
});
