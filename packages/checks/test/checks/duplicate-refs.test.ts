import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks } from '../../src/index.ts';

const run = checks['duplicate-refs'].run;

test('reports a duplicate reference within one entry', () => {
  const findings = run({
    artifact: { components: [{ id: 'C1', satisfies: ['REQ-1', 'REQ-2', 'REQ-1'] }] },
    params: { array: 'components', list_field: 'satisfies' },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'duplicate-refs');
  assert.equal(findings[0].category, 'traceability');
  assert.equal(findings[0].target, 'components[].satisfies');
  assert.ok(findings[0].finding.includes("Duplicate REQ reference 'REQ-1' in C1"));
});

test('accepts entries without duplicates', () => {
  assert.deepEqual(
    run({
      artifact: { components: [{ id: 'C1', satisfies: ['REQ-1', 'REQ-2'] }] },
      params: { array: 'components', list_field: 'satisfies' },
    }),
    []
  );
});

test('derives a prefix from the reference, falling back to "reference"', () => {
  const findings = run({
    artifact: {
      components: [
        { id: 'C1', satisfies: ['TASK-1', 'TASK-1'] },
        { id: 'C2', satisfies: ['plain', 'plain'] },
      ],
    },
    params: { array: 'components', list_field: 'satisfies' },
  });

  assert.equal(findings.length, 2);
  assert.ok(findings[0].finding.includes('Duplicate TASK reference'));
  assert.ok(findings[1].finding.includes('Duplicate reference'));
});

test('entries whose list field is not an array are skipped', () => {
  assert.deepEqual(
    run({
      artifact: { components: [{ id: 'C1', satisfies: 'REQ-1' }] },
      params: { array: 'components', list_field: 'satisfies' },
    }),
    []
  );
});

test('scans path-resolved arrays too', () => {
  const findings = run({
    artifact: { groups: [{ items: [{ id: 'X', refs: ['A-1', 'A-1'] }] }] },
    params: { array: 'groups[].items', list_field: 'refs' },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'groups[].items[].refs');
});

test('missing required parameters abort the run', () => {
  assert.throws(
    () => run({ artifact: {} }),
    (err: Error) => err.message.includes('required parameter(s): array, list_field')
  );
});
