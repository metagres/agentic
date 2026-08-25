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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-change-res-'));
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  });
}

test('status resolves a natural-language change name to its slug', () => {
  const tmp = makeTmpProject();

  const req = runCli([
    'requirements',
    '--cwd',
    tmp,
    '--request',
    'Genericize the stage engine',
  ]);
  assert.equal(req.status, 0, req.stderr);
  const reqJson = JSON.parse(req.stdout);
  assert.equal(
    path.basename(reqJson.data.change_root),
    'genericize-the-stage-engine'
  );

  // The user's exact scenario: the CLI is invoked with a change name that is
  // not the slug (slug derives from the full request text).
  const res = runCli(['status', '--cwd', tmp, '--change', 'stage engine']);
  assert.equal(res.status, 0, res.stdout);
  const json = JSON.parse(res.stdout);
  assert.equal(json.workflow, 'status');
  assert.equal(json.data.change_name, 'genericize-the-stage-engine');
});

test('status failure lists available changes in the envelope', () => {
  const tmp = makeTmpProject();

  const req = runCli([
    'requirements',
    '--cwd',
    tmp,
    '--request',
    'Genericize the stage engine',
  ]);
  assert.equal(req.status, 0, req.stderr);

  const res = runCli(['status', '--cwd', tmp, '--change', 'nonexistent-thing']);
  assert.equal(res.status, 3, res.stdout);
  const json = JSON.parse(res.stdout);
  assert.equal(json.state, 'blocked');
  assert.ok(
    json.data.available_changes.includes('genericize-the-stage-engine'),
    JSON.stringify(json.data)
  );
  assert.equal(json.data.searched, path.join(tmp, 'docs', 'changes'));
});

test('status from a nested subdir treats that subdir as the project root', () => {
  const tmp = makeTmpProject();

  const req = runCli([
    'requirements',
    '--cwd',
    tmp,
    '--request',
    'Genericize the stage engine',
  ]);
  assert.equal(req.status, 0, req.stderr);

  const sub = path.join(tmp, 'sub');
  fs.mkdirSync(sub, { recursive: true });

  const res = runCli(['status', '--cwd', sub, '--change', 'nonexistent-thing']);
  assert.equal(res.status, 3, res.stdout);
  const json = JSON.parse(res.stdout);
  assert.equal(json.state, 'blocked');
  assert.ok(
    json.instructions.includes(`docs/changes does not exist under ${path.resolve(sub)}`),
    json.instructions
  );
  assert.equal(json.data.searched, path.join(sub, 'docs', 'changes'));
  assert.deepEqual(json.data.available_changes, []);
  assert.ok(!('suggested_cwd' in json.data), JSON.stringify(json.data));
});
