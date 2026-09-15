import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks } from '../../src/index.ts';

const run = checks['unique-ids'].run;

test('reports duplicate ids within one array', () => {
  const findings = run({
    artifact: { tasks: [{ id: 'T1' }, { id: 'T2' }, { id: 'T1' }] },
    params: { arrays: ['tasks'] },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'unique-ids');
  assert.equal(findings[0].category, 'structural');
  assert.equal(findings[0].target, 'tasks[].id');
  assert.ok(findings[0].finding.includes("Duplicate ID 'T1' in 'tasks'"));
  assert.ok(findings[0].fix!.includes('unique id'));
});

test('accepts unique ids with no findings', () => {
  assert.deepEqual(
    run({
      artifact: { tasks: [{ id: 'T1' }, { id: 'T2' }] },
      params: { arrays: ['tasks'] },
    }),
    []
  );
});

test('supports a custom id_field', () => {
  const findings = run({
    artifact: { items: [{ key: 'K1' }, { key: 'K1' }] },
    params: { arrays: ['items'], id_field: 'key' },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'items[].key');
  assert.ok(findings[0].finding.includes("Duplicate ID 'K1'"));
});

test('resolves path specs in arrays', () => {
  const findings = run({
    artifact: { epics: [{ features: [{ id: 'F1' }, { id: 'F1' }] }] },
    params: { arrays: ['epics[].features'] },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'epics[].features[].id');
});

test('unions enforce one uniqueness scope across collections', () => {
  const findings = run({
    artifact: {
      components: [{ id: 'C1' }],
      interfaces: [{ id: 'C1' }],
    },
    params: { arrays: [], unions: [{ arrays: ['components', 'interfaces'] }] },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'components + interfaces');
  assert.ok(findings[0].finding.includes("Duplicate ID 'C1' at components[0], interfaces[0]"));
});

test('union groups without duplicates produce no findings', () => {
  assert.deepEqual(
    run({
      artifact: {
        components: [{ id: 'C1' }],
        interfaces: [{ id: 'I1' }],
      },
      params: { arrays: [], unions: [{ arrays: ['components', 'interfaces'] }] },
    }),
    []
  );
});

test('absent arrays and non-string ids are ignored', () => {
  assert.deepEqual(
    run({
      artifact: { tasks: [{}, { id: 42 }] },
      params: { arrays: ['missing', 'tasks'] },
    }),
    []
  );
});

test('an empty artifact produces no findings', () => {
  assert.deepEqual(run({ artifact: {}, params: { arrays: ['tasks'] } }), []);
});
