import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { validateWithSchema } from '../../src/scripts/lib/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function tmpRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(tmp: string, args: string[]) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function assertEnvelopeShape(payload: Record<string, unknown>) {
  const findings = validateWithSchema(payload, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, []);
}

function seedPlan(
  tmp: string,
  changeDir: string,
  tasks: { id: string; status: string; note?: string }[],
  implementationStatus: string
): string {
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);
  fs.mkdirSync(changeRoot, { recursive: true });
  const body = [
    'metadata:',
    '  id: PLAN-001',
    '  title: Test plan',
    '  stage: planning',
    '  status: accepted',
    '  version: 0.1.0',
    `  implementation_status: ${implementationStatus}`,
    'tasks:',
    ...tasks.flatMap((task) => [
      `  - id: ${task.id}`,
      '    title: Do the thing',
      '    description: Implement the thing.',
      '    type: implementation',
      `    status: ${task.status}`,
      '    covers: [FR-001]',
      '    acceptance_ids: [AC-001]',
      ...(task.note ? [`    implementation_note: ${JSON.stringify(task.note)}`] : []),
    ]),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(changeRoot, 'plan.yaml'), body, 'utf8');
  return changeDir;
}

function loadPlan(tmp: string, changeDir: string): Record<string, unknown> {
  return readYaml(path.join(tmp, 'docs', 'changes', changeDir, 'plan.yaml')) as Record<
    string,
    unknown
  >;
}

test('task-add appends the next task id with the given fields and pending status', () => {
  const tmp = tmpRepo('agentic-tasks-');
  const changeDir = seedPlan(
    tmp,
    'task-add',
    [
      { id: 'TASK-001', status: 'done', note: 'Implemented TASK-001 with tests.' },
      { id: 'TASK-002', status: 'done', note: 'Implemented TASK-002 with tests.' },
      { id: 'TASK-003', status: 'done', note: 'Implemented TASK-003 with tests.' },
    ],
    'ready-for-review'
  );

  const out = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-add',
    'Wire the retry path',
    '--description',
    'Handle the retry budget.',
    '--depends-on',
    'TASK-001',
    '--files',
    'create:src/retry.ts',
    '--covers',
    'FR-001',
    '--acceptance-ids',
    'AC-001',
  ]);
  assertEnvelopeShape(out);
  assert.equal(out.errors.length, 0, JSON.stringify(out.errors));
  assert.match(String(out.instructions), /TASK-004 added/);

  const plan = loadPlan(tmp, changeDir);
  const tasks = plan.tasks as Record<string, unknown>[];
  assert.equal(tasks.length, 4);
  const added = tasks[3];
  assert.equal(added.id, 'TASK-004');
  assert.equal(added.title, 'Wire the retry path');
  assert.equal(added.description, 'Handle the retry budget.');
  assert.deepEqual(added.depends_on, ['TASK-001']);
  assert.deepEqual(added.files, [{ path: 'src/retry.ts', operation: 'create' }]);
  assert.deepEqual(added.covers, ['FR-001']);
  assert.deepEqual(added.acceptance_ids, ['AC-001']);
  assert.equal(added.status, 'pending');
});

test('task-add refuses unknown depends_on ids before any write', () => {
  const tmp = tmpRepo('agentic-tasks-');
  const changeDir = seedPlan(
    tmp,
    'task-dep',
    [{ id: 'TASK-001', status: 'pending' }],
    'pending'
  );

  const out = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-add',
    'Wire the retry path',
    '--depends-on',
    'TASK-999',
    '--covers',
    'FR-001',
    '--acceptance-ids',
    'AC-001',
  ]);
  assertEnvelopeShape(out);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'TASK_DEPENDS_ON_UNKNOWN');
  assert.match(String(out.instructions), /TASK-999/);
  assert.ok(Array.isArray(out.data.known_task_ids));

  const plan = loadPlan(tmp, changeDir);
  assert.equal((plan.tasks as unknown[]).length, 1);
});

test('task-add requires covers and acceptance ids', () => {
  const tmp = tmpRepo('agentic-tasks-');
  const changeDir = seedPlan(
    tmp,
    'task-covers',
    [{ id: 'TASK-001', status: 'pending' }],
    'pending'
  );

  const out = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-add',
    'Wire the retry path',
  ]);
  assertEnvelopeShape(out);
  assert.equal(out.state, 'blocked');
  assert.match(String(out.errors[0].message), /--covers/);
});

test('removing a done task is refused and the plan stays unchanged', () => {
  const tmp = tmpRepo('agentic-tasks-');
  const changeDir = seedPlan(
    tmp,
    'task-remove-done',
    [{ id: 'TASK-001', status: 'done', note: 'Implemented TASK-001 with tests.' }],
    'ready-for-review'
  );

  const out = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-remove',
    'TASK-001',
  ]);
  assertEnvelopeShape(out);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'TASK_REMOVE_NOT_ALLOWED');

  const plan = loadPlan(tmp, changeDir);
  assert.equal((plan.tasks as unknown[]).length, 1);
});

test('removing the last remaining skipped task reopens a review-settled implementation', () => {
  const tmp = tmpRepo('agentic-tasks-');
  const changeDir = seedPlan(
    tmp,
    'task-remove-reopen',
    [{ id: 'TASK-001', status: 'skipped' }],
    'ready-for-review'
  );

  const out = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-remove',
    'TASK-001',
  ]);
  assertEnvelopeShape(out);
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));
  assert.match(String(out.instructions), /TASK-001 removed/);

  const plan = loadPlan(tmp, changeDir);
  assert.equal((plan.tasks as unknown[]).length, 0);
  assert.equal((plan.metadata as Record<string, unknown>).implementation_status, 'in_progress');
});

test('task mutation verbs are mutually exclusive', () => {
  const tmp = tmpRepo('agentic-tasks-');
  const changeDir = seedPlan(
    tmp,
    'task-conflict',
    [{ id: 'TASK-001', status: 'pending' }],
    'pending'
  );

  const out = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-add',
    'A task',
    '--task-id',
    'TASK-001',
    '--status',
    'done',
    '--covers',
    'FR-001',
    '--acceptance-ids',
    'AC-001',
  ]);
  assertEnvelopeShape(out);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
});
