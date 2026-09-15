import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks } from '../../src/index.ts';

const run = checks['dependency-order'].run;

const PARAMS = { array: 'tasks' };

test('accepts tasks ordered dependencies-first', () => {
  assert.deepEqual(
    run({
      artifact: {
        tasks: [
          { id: 'T1', depends_on: [] },
          { id: 'T2', depends_on: ['T1'] },
        ],
      },
      params: PARAMS,
    }),
    []
  );
});

test('reports a forward dependency', () => {
  const findings = run({
    artifact: {
      tasks: [
        { id: 'T1', depends_on: ['T3'] },
        { id: 'T2', depends_on: [] },
        { id: 'T3', depends_on: [] },
      ],
    },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'dependency-order');
  assert.equal(findings[0].category, 'structural');
  assert.equal(findings[0].target, 'tasks');
  assert.equal(findings[0].finding, 'Task T1 depends on T3 which appears later in the plan');
});

test('reports one finding per forward dependency', () => {
  const findings = run({
    artifact: {
      tasks: [
        { id: 'T1', depends_on: ['T2', 'T3'] },
        { id: 'T2', depends_on: ['T3'] },
        { id: 'T3', depends_on: [] },
      ],
    },
    params: PARAMS,
  });

  assert.equal(findings.length, 3);
});

test('dependencies on unknown ids are ignored', () => {
  assert.deepEqual(
    run({
      artifact: { tasks: [{ id: 'T1', depends_on: ['GHOST'] }] },
      params: PARAMS,
    }),
    []
  );
});

test('supports custom id_field and depends_field', () => {
  const findings = run({
    artifact: {
      jobs: [{ key: 'A', needs: ['B'] }, { key: 'B', needs: [] }],
    },
    params: { array: 'jobs', id_field: 'key', depends_field: 'needs' },
  });

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('Task A depends on B'));
});

test('missing required parameters abort the run', () => {
  assert.throws(
    () => run({ artifact: {} }),
    (err: Error) => err.message.includes('required parameter(s): array')
  );
});
