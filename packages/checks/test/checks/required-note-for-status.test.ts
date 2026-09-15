import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks } from '../../src/index.ts';

const run = checks['required-note-for-status'].run;

const PARAMS = { array: 'tasks', statuses: ['done', 'blocked'] };

test('reports a terminal-status entry without a note', () => {
  const findings = run({
    artifact: { tasks: [{ id: 'T1', status: 'done' }] },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'required-note-for-status');
  assert.equal(findings[0].category, 'completeness');
  assert.equal(findings[0].target, 'tasks[].implementation_note');
  assert.equal(findings[0].finding, "Task T1 has status 'done' but no implementation_note");
});

test('accepts terminal-status entries that carry a note', () => {
  assert.deepEqual(
    run({
      artifact: { tasks: [{ id: 'T1', status: 'done', implementation_note: 'Shipped; verified by test X' }] },
      params: PARAMS,
    }),
    []
  );
});

test('a whitespace-only note counts as missing', () => {
  const findings = run({
    artifact: { tasks: [{ id: 'T1', status: 'blocked', implementation_note: '   ' }] },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('status \'blocked\''));
});

test('entries with other statuses are ignored', () => {
  assert.deepEqual(
    run({
      artifact: { tasks: [{ id: 'T1', status: 'open' }, { id: 'T2', status: 'in_progress' }] },
      params: PARAMS,
    }),
    []
  );
});

test('supports a custom note_field', () => {
  const findings = run({
    artifact: { tasks: [{ id: 'T1', status: 'done' }] },
    params: { ...PARAMS, note_field: 'note' },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'tasks[].note');
  assert.ok(findings[0].finding.includes('but no note'));
});

test('entries without an id are reported as "entry"', () => {
  const findings = run({
    artifact: { tasks: [{ status: 'done' }] },
    params: PARAMS,
  });

  assert.ok(findings[0].finding.startsWith('Task entry has status'));
});

test('missing required parameters abort the run', () => {
  assert.throws(
    () => run({ artifact: {} }),
    (err: Error) => err.message.includes('required parameter(s): array, statuses')
  );
});
