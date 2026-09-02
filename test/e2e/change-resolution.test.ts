import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CWD_FLAG_DOC } from '../../src/scripts/lib/cli.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '../../src/scripts/sdlc.ts');

/** The frozen CLI envelope top-level fields (invariant 8, AC-011). */
const FROZEN_FIELDS = [
  'workflow',
  'step',
  'state',
  'instructions',
  'data',
  'errors',
  'warnings',
];

function makeTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-change-res-'));
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    ...opts,
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

test('--cwd override resolves exactly as if invoked from the project root', () => {
  const tmp = makeTmpProject();

  const req = runCli([
    'requirements',
    '--cwd',
    tmp,
    '--request',
    'Genericize the stage engine',
  ]);
  assert.equal(req.status, 0, req.stderr);

  // A bare directory that is not the project root and has no docs/changes.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-change-res-elsewhere-'));

  const fromRoot = runCli(['status', '--cwd', tmp, '--change', 'stage engine']);
  assert.equal(fromRoot.status, 0, fromRoot.stdout);

  const overridden = runCli(['status', '--cwd', tmp, '--change', 'stage engine'], {
    cwd: elsewhere,
  });
  assert.equal(overridden.status, 0, overridden.stdout);

  const rootJson = JSON.parse(fromRoot.stdout);
  const overrideJson = JSON.parse(overridden.stdout);
  // Identical resolution: same state, change name, and change root as the
  // project-root invocation.
  assert.equal(overrideJson.state, rootJson.state);
  assert.equal(overrideJson.data.change_name, rootJson.data.change_name);
  assert.equal(overrideJson.data.change_root, rootJson.data.change_root);
  assert.equal(overrideJson.data.change_root, path.join(tmp, 'docs', 'changes', 'genericize-the-stage-engine'));
});

test('invalid --cwd produces a blocked envelope naming the invalid root', () => {
  const invalid = path.join(os.tmpdir(), 'agentic-change-res-missing', 'no-such-root');

  const res = runCli(['status', '--change', 'anything', '--cwd', invalid]);
  assert.notEqual(res.status, 0, res.stdout);

  const json = JSON.parse(res.stdout);
  // Exactly the seven frozen top-level envelope fields (AC-011).
  assert.deepEqual(Object.keys(json).sort(), [...FROZEN_FIELDS].sort());
  assert.equal(json.state, 'blocked');
  // The message and data.searched name the override-provided path (AC-003/AC-004).
  assert.ok(json.instructions.includes('docs/changes does not exist under'), json.instructions);
  assert.ok(json.instructions.includes(path.resolve(invalid)), json.instructions);
  assert.ok(
    json.instructions.includes(
      'Run from the project root or pass the root explicitly with --cwd <project-root>.'
    ),
    json.instructions
  );
  assert.ok(!json.instructions.includes('Create a change first'), json.instructions);
  assert.equal(json.data.searched, path.join(path.resolve(invalid), 'docs', 'changes'));
});

test('help output documents the --cwd override flag on every usage surface', () => {
  // Top-level help.
  const top = runCli([]);
  assert.equal(top.status, 0, top.stderr);
  const topJson = JSON.parse(top.stdout);
  assert.ok(topJson.instructions.includes(CWD_FLAG_DOC), topJson.instructions);

  // A cross-cutting workflow usage surface.
  const status = runCli(['status', '--help']);
  assert.equal(status.status, 0, status.stderr);
  const statusJson = JSON.parse(status.stdout);
  assert.ok(statusJson.instructions.includes(CWD_FLAG_DOC), statusJson.instructions);

  // An authoring stage helpPayload.
  const stage = runCli(['requirements', '--help']);
  assert.equal(stage.status, 0, stage.stderr);
  const stageJson = JSON.parse(stage.stdout);
  assert.ok(stageJson.instructions.includes(CWD_FLAG_DOC), stageJson.instructions);
});
