import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks } from '../../src/index.ts';

const run = checks['all-tasks-terminal'].run;

const PARAMS = { array: 'tasks', allowed_statuses: ['done', 'skipped'] };

test('accepts an array where every entry has a terminal status', () => {
  assert.deepEqual(
    run({
      artifact: { tasks: [{ id: 'T1', status: 'done' }, { id: 'T2', status: 'skipped' }] },
      params: PARAMS,
    }),
    []
  );
});

test('reports one finding when any entry is not terminal', () => {
  const findings = run({
    artifact: { tasks: [{ id: 'T1', status: 'done' }, { id: 'T2', status: 'open' }] },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'all-tasks-terminal');
  assert.equal(findings[0].category, 'completeness');
  assert.equal(findings[0].target, 'tasks');
  assert.equal(findings[0].finding, 'Not all tasks are complete (1 of 2 done/skipped)');
});

test('an empty array produces no findings', () => {
  assert.deepEqual(run({ artifact: { tasks: [] }, params: PARAMS }), []);
});

test('an absent array produces no findings', () => {
  assert.deepEqual(run({ artifact: {}, params: PARAMS }), []);
});

test('missing required parameters abort the run', () => {
  assert.throws(
    () => run({ artifact: {} }),
    (err: Error) => err.message.includes('required parameter(s): array, allowed_statuses')
  );
});
