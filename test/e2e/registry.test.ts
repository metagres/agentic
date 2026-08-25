import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getStageDescriptions } from '../../src/scripts/lib/stage-registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.resolve(__dirname, '../../src/scripts/sdlc.ts');

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  });
}

const CROSS_CUTTING_IDS = ['status', 'feedback', 'doctor'];

test('--list-workflows lists discovered stages plus cross-cutting commands', () => {
  const res = runCli(['--list-workflows']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'cli');
  assert.equal(json.state, 'ok');

  const ids = json.data.workflows.map((w) => w.id);

  // Every stage discovered by the registry appears without any TypeScript
  // change; the expectation derives from the registry itself.
  const discovered = getStageDescriptions(root).map((s) => s.id);
  for (const id of discovered) {
    assert.ok(ids.includes(id), `expected discovered stage '${id}' in ${ids.join(', ')}`);
  }
  assert.equal(discovered.length, 9);

  // Cross-cutting commands are listed alongside the stages.
  for (const id of CROSS_CUTTING_IDS) {
    assert.ok(ids.includes(id), `expected cross-cutting command '${id}' in ${ids.join(', ')}`);
  }

  // The dedicated review command is gone; review stages are stage commands.
  assert.ok(!ids.includes('review'));
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
