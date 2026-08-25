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
    '--change',
    changeDir,
  ]);

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.workflow, 'status');
  assert.equal(json.data.current_workflow, 'requirements');
  assert.equal(json.data.pipeline.requirements, 'draft');
  assert.ok(json.data.suggested_command.includes('requirements'));
});

test('status lists review stages in the pipeline and suggests the review gate when ready', () => {
  const tmp = makeTmpProject();
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'index.md'),
    [
      '# Current Docs Index',
      '| File | Purpose | When to Read | Notes |',
      '|---|---|---|---|',
      '| docs/current/architecture.md | Tech stack, boundaries, folder responsibilities | Structural changes | Fixture |',
      '| docs/current/api-contract.md | Endpoints: method, path, auth, shapes | API changes | Fixture |',
      '| docs/current/glossary.md | Entities, fields, relationships, rules | Data layer changes | Fixture |',
      '| docs/current/capabilities.md | Features, workflows, user journeys | Feature changes | Fixture |',
      '| docs/current/conventions.md | Patterns, naming, error handling, file org | Code writing | Fixture |',
      '| docs/current/operations.md | Build, test, lint, deploy, env vars | Verification | Fixture |',
      '| docs/current/dependencies.md | Key libraries and roles | Dependency changes | Fixture |',
      '| docs/current/known-issues.md | Markers, skipped tests | Task estimation | Fixture |',
      '| docs/current/decisions.md | ADRs (reference) + cycle decisions (living) | Architectural changes | Fixture |',
      '',
    ].join('\n'),
    'utf8'
  );

  const req = runCli(['requirements', '--cwd', tmp, '--request', 'Add login']);
  assert.equal(req.status, 0, req.stderr);
  const reqJson = JSON.parse(req.stdout);
  const changeDir = path.basename(reqJson.data.change_root);

  // All review stages appear in the pipeline map.
  let res = runCli(['status', '--cwd', tmp, '--change', changeDir]);
  assert.equal(res.status, 0, res.stderr);
  let json = JSON.parse(res.stdout);
  assert.ok('requirements-review' in json.data.pipeline);
  assert.ok('design-review' in json.data.pipeline);
  assert.ok('planning-review' in json.data.pipeline);
  assert.ok('implementation-review' in json.data.pipeline);

  // Fill in a valid requirements artifact, finalize it, and confirm status
  // suggests the requirements-review stage command.
  res = runCli(
    ['requirements', '--cwd', tmp, '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request: 'Add login' }))
  );
  assert.equal(res.status, 0, res.stderr);

  res = runCli(['requirements', '--cwd', tmp, '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).state, 'complete', res.stdout);

  res = runCli(['status', '--cwd', tmp, '--change', changeDir]);
  assert.equal(res.status, 0, res.stderr);
  json = JSON.parse(res.stdout);
  assert.equal(json.data.current_workflow, 'requirements-review');
  assert.ok(json.data.suggested_command.includes('requirements-review'));
});
