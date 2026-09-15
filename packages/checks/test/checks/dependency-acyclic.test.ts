import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks } from '../../src/index.ts';

const run = checks['dependency-acyclic'].run;

const PARAMS = { array: 'tasks' };

test('accepts an acyclic dependency graph', () => {
  assert.deepEqual(
    run({
      artifact: {
        tasks: [
          { id: 'T1', depends_on: [] },
          { id: 'T2', depends_on: ['T1'] },
          { id: 'T3', depends_on: ['T1', 'T2'] },
        ],
      },
      params: PARAMS,
    }),
    []
  );
});

test('reports a dependency cycle', () => {
  const findings = run({
    artifact: {
      tasks: [
        { id: 'T1', depends_on: ['T2'] },
        { id: 'T2', depends_on: ['T1'] },
      ],
    },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'dependency-acyclic');
  assert.equal(findings[0].category, 'structural');
  assert.equal(findings[0].target, 'tasks');
  assert.equal(findings[0].finding, 'Task dependency graph contains a cycle.');
});

test('detects self-dependencies as cycles', () => {
  const findings = run({
    artifact: { tasks: [{ id: 'T1', depends_on: ['T1'] }] },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
});

test('dependencies on unknown ids do not count as cycles', () => {
  assert.deepEqual(
    run({
      artifact: { tasks: [{ id: 'T1', depends_on: ['GHOST'] }] },
      params: PARAMS,
    }),
    []
  );
});

test('supports custom id_field and depends_field', () => {
  assert.deepEqual(
    run({
      artifact: {
        jobs: [{ key: 'A', needs: ['B'] }, { key: 'B', needs: [] }],
      },
      params: { array: 'jobs', id_field: 'key', depends_field: 'needs' },
    }),
    []
  );

  const cycle = run({
    artifact: {
      jobs: [{ key: 'A', needs: ['B'] }, { key: 'B', needs: ['A'] }],
    },
    params: { array: 'jobs', id_field: 'key', depends_field: 'needs' },
  });

  assert.equal(cycle.length, 1);
});

test('a long cycle is detected', () => {
  const findings = run({
    artifact: {
      tasks: [
        { id: 'T1', depends_on: ['T3'] },
        { id: 'T2', depends_on: ['T1'] },
        { id: 'T3', depends_on: ['T2'] },
      ],
    },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
});

test('missing required parameters abort the run', () => {
  assert.throws(
    () => run({ artifact: {} }),
    (err: Error) => err.message.includes('required parameter(s): array')
  );
});
