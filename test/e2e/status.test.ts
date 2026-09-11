import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validRequirements } from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '../../src/scripts/sdlc.ts');

function makeTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-status-'));
}

function runCli(args, input) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    input,
  });
}

test('--version returns version', () => {
  const res = runCli(['--version']);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.command, 'cli');
  assert.equal(json.state, 'ok');
  assert.ok(json.data.version);
});

test('status reports requirements as current for a new change', () => {
  const tmp = makeTmpProject();

  const init = runCli(['init', '--cwd', tmp, '--change', 'add-login']);
  assert.equal(init.status, 0, init.stderr);

  const req = runCli(['requirements', '--cwd', tmp, '--change', 'add-login']);
  assert.equal(req.status, 0, req.stderr);

  const reqJson = JSON.parse(req.stdout);
  const changeDir = path.basename(reqJson.data.change_root);

  const res = runCli([
    'status',
    '--cwd',
    tmp,
    '--change',
    changeDir,
  ]);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.command, 'status');
  assert.equal(json.data.stage, 'requirements');
  assert.equal(json.data.agent, 'requirements-analyst');
  assert.equal(json.data.suggested_command, `sdlc requirements --change ${changeDir}`);

  // Exactly the slim data shape — no per-stage pipeline, no change_root.
  assert.deepEqual(Object.keys(json.data).sort(), [
    'agent',
    'change_name',
    'stage',
    'suggested_command',
  ]);
});

test('status suggests the review gate with the reviewer agent when ready', () => {
  const tmp = makeTmpProject();
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'architecture.md'),
    '# architecture.md\n',
    'utf8'
  );

  const init = runCli(['init', '--cwd', tmp, '--change', 'add-login']);
  assert.equal(init.status, 0, init.stderr);
  const req = runCli(['requirements', '--cwd', tmp, '--change', 'add-login']);
  assert.equal(req.status, 0, req.stderr);
  const reqJson = JSON.parse(req.stdout);
  const changeDir = path.basename(reqJson.data.change_root);

  // Fill in a valid requirements artifact, finalize it, and confirm status
  // suggests the requirements-review stage command.
  let res = runCli(
    ['requirements', '--cwd', tmp, '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request: 'Add login' }))
  );
  assert.equal(res.status, 0, res.stderr);

  res = runCli(['requirements', '--cwd', tmp, '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).state, 'complete', res.stdout);

  res = runCli(['status', '--cwd', tmp, '--change', changeDir]);
  assert.equal(res.status, 0, res.stderr);
  const json = JSON.parse(res.stdout);
  assert.equal(json.data.stage, 'requirements-review');
  assert.equal(json.data.agent, 'stage-reviewer');
  assert.ok(json.data.suggested_command.includes('requirements-review'));
});

test('status reports the complete state once every stage is settled', () => {
  const tmp = makeTmpProject();
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'architecture.md'),
    '# architecture.md\n',
    'utf8'
  );

  const init = runCli(['init', '--cwd', tmp, '--change', 'add-login']);
  assert.equal(init.status, 0, init.stderr);
  const req = runCli(['requirements', '--cwd', tmp, '--change', 'add-login']);
  assert.equal(req.status, 0, req.stderr);
  const reqJson = JSON.parse(req.stdout);
  const changeDir = path.basename(reqJson.data.change_root);
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);

  // Settle every tracked artifact (review stages track the artifact of the
  // stage they review; the aggregator completes on status 'complete') so the
  // slim envelope reports the loop-control complete state.
  const writeStatus = (file, metadata) => {
    fs.writeFileSync(
      path.join(changeRoot, file),
      JSON.stringify({ metadata }),
      'utf8'
    );
  };
  writeStatus('requirements.yaml', { status: 'accepted' });
  writeStatus('design.yaml', { status: 'accepted' });
  writeStatus('plan.yaml', { status: 'accepted', implementation_status: 'accepted' });
  writeStatus('docs-delta.yaml', { status: 'complete' });

  const res = runCli(['status', '--cwd', tmp, '--change', changeDir]);
  assert.equal(res.status, 0, res.stderr);
  const json = JSON.parse(res.stdout);
  assert.equal(json.state, 'complete');
  assert.equal(json.data.stage, 'complete');
  assert.equal(json.data.agent, null);
  assert.equal(json.data.suggested_command, null);
});
