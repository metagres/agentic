import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { validateWithSchema } from '../../src/scripts/lib/schema.ts';
import { today } from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function tmpRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(tmp: string, args: string[], input?: string) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function assertEnvelopeShape(payload: Record<string, unknown>) {
  const findings = validateWithSchema(payload, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, []);
}

// Seeds docs/changes/<changeDir>/plan.yaml with an accepted planning status so
// the implementation acceptance gate (planning-review -> planning) passes.
// Tasks carry no bookkeeping fields: started_at, completed_at, and
// files_changed are owned by the tasks interpreter.
function seedPlan(tmp: string, changeDir: string, taskId: string, status: string): string {
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);
  fs.mkdirSync(changeRoot, { recursive: true });
  const body = [
    'metadata:',
    '  id: PLAN-001',
    '  title: Test plan',
    '  stage: planning',
    '  status: accepted',
    '  version: 0.1.0',
    'tasks:',
    `  - id: ${taskId}`,
    '    title: Do the thing',
    '    description: Implement the thing.',
    '    type: implementation',
    `    status: ${status}`,
    '    depends_on: []',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(changeRoot, 'plan.yaml'), body, 'utf8');
  return changeDir;
}

function savedTask(tmp: string, changeDir: string): Record<string, unknown> {
  const plan = readYaml(path.join(tmp, 'docs', 'changes', changeDir, 'plan.yaml')) as {
    tasks: Record<string, unknown>[];
  };
  return plan.tasks[0];
}

test('a done transition without a note is rejected at write time naming the task', () => {
  const tmp = tmpRepo('agentic-wte-');
  const changeDir = seedPlan(tmp, 'noteless-done', 'TASK-001', 'in_progress');

  const out = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-id',
    'TASK-001',
    '--status',
    'done',
  ]);

  assertEnvelopeShape(out);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'TASK_DONE_REQUIRES_NOTE');
  assert.match(String(out.errors[0].message), /TASK-001/);
  assert.match(String(out.instructions), /TASK-001/);

  // Write-time rejection: nothing was persisted.
  const task = savedTask(tmp, changeDir);
  assert.equal(task.status, 'in_progress');
  assert.equal(task.completed_at ?? null, null);
});

test('a done transition with a note is accepted and the interpreter owns the state fields', () => {
  const tmp = tmpRepo('agentic-wte-');
  const changeDir = seedPlan(tmp, 'noted-done', 'TASK-001', 'pending');

  // in_progress stamps started_at and appends files_changed.
  let out = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-id',
    'TASK-001',
    '--status',
    'in_progress',
    '--files',
    'create:src/devices.ts',
  ]);
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  let task = savedTask(tmp, changeDir);
  assert.equal(task.status, 'in_progress');
  assert.equal(task.started_at, today());
  assert.deepEqual(task.files_changed, [{ path: 'src/devices.ts', operation: 'create' }]);

  // done requires the note, stamps completed_at, and accumulates files_changed
  // instead of replacing it.
  out = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-id',
    'TASK-001',
    '--status',
    'done',
    '--note',
    'Implemented the registration endpoint and persistence layer.',
    '--files',
    'modify:src/devices.ts,create:src/routes/register.ts',
  ]);
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));
  assertEnvelopeShape(out);

  task = savedTask(tmp, changeDir);
  assert.equal(task.status, 'done');
  assert.equal(
    task.implementation_note,
    'Implemented the registration endpoint and persistence layer.'
  );
  assert.equal(task.completed_at, today());
  assert.deepEqual(task.files_changed, [
    { path: 'src/devices.ts', operation: 'create' },
    { path: 'src/devices.ts', operation: 'modify' },
    { path: 'src/routes/register.ts', operation: 'create' },
  ]);
});

test('update-artifact normalizes delta entries lacking phase and date', () => {
  const tmp = tmpRepo('agentic-wte-');

  let out = runCli(tmp, ['requirements', '--request', 'Add device registration']);
  assertEnvelopeShape(out);
  const changeRoot = String(out.data.change_root);
  const changeDir = path.basename(changeRoot);

  const input = {
    delta: [
      {
        target_doc: 'docs/current/architecture.md',
        change: 'Add',
        reason: 'Describe the device registration flow added by this change.',
      },
    ],
  };

  out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(input)
  );
  assertEnvelopeShape(out);
  assert.equal(out.errors.length, 0, JSON.stringify(out.errors));

  const saved = readYaml(path.join(changeRoot, 'requirements.yaml')) as {
    delta: Record<string, unknown>[];
  };
  assert.equal(saved.delta.length, 1);
  assert.equal(saved.delta[0].phase, 'Requirements');
  assert.equal(saved.delta[0].date, today());
  assert.equal(saved.delta[0].target_doc, 'docs/current/architecture.md');
});

test('the authoring envelope omits step_help by default and restores it with --help-step', () => {
  const tmp = tmpRepo('agentic-help-');

  const first = runCli(tmp, ['requirements', '--request', 'Add device registration']);
  assertEnvelopeShape(first);
  assert.ok(!('step_help' in first.data), 'step_help must be absent by default');

  const changeDir = path.basename(String(first.data.change_root));
  const second = runCli(tmp, ['requirements', '--change', changeDir, '--help-step']);
  assertEnvelopeShape(second);
  assert.ok(second.data.step_help, '--help-step must restore step_help');
  assert.ok(second.data.step_help.title);
  assert.ok(typeof second.data.step_help.markdown === 'string');
  assert.ok(Array.isArray(second.data.step_help.commands));
});
