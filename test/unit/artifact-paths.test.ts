import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCollections,
  resolveLeafValues,
} from '../../src/scripts/lib/artifact-paths.ts';
import { getTopArray, resolvePath } from '../../src/scripts/lib/checks/shared.ts';

function nestedDoc() {
  return {
    problem_statement: 'Operators cannot register devices.',
    functional_requirements: [
      {
        id: 'FR-001',
        description: 'The system shall create a device record.',
        acceptance_criteria: [
          { id: 'AC-001', statement: 'Given none, When submitted, Then 201.', category: 'happy' },
          { id: 'AC-002', statement: 'Given duplicate, When submitted, Then 409.', category: 'negative' },
        ],
      },
      {
        id: 'FR-002',
        description: 'The system shall reject unknown devices.',
        acceptance_criteria: [
          { id: 'AC-003', statement: 'Given unknown, When queried, Then 404.', category: 'edge' },
        ],
      },
    ],
    non_functional_requirements: [
      {
        id: 'NFR-001',
        description: 'The endpoint shall respond within 500 ms.',
        acceptance_criteria: [
          { id: 'AC-004', statement: 'Given load, When measured, Then under 500 ms.', category: 'boundary' },
        ],
      },
    ],
  };
}

test('resolveCollections resolves a single-segment top-level array', () => {
  const doc = nestedDoc();
  const resolved = resolveCollections(doc, 'functional_requirements');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].location, 'functional_requirements');
  assert.equal(resolved[0].items.length, 2);
  assert.equal(resolved[0].items[0].id, 'FR-001');
});

test('resolveCollections resolves a two-segment nested array with indexed locations', () => {
  const doc = nestedDoc();
  const resolved = resolveCollections(doc, 'functional_requirements[].acceptance_criteria');
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].location, 'functional_requirements[0].acceptance_criteria');
  assert.equal(resolved[0].items.length, 2);
  assert.equal(resolved[1].location, 'functional_requirements[1].acceptance_criteria');
  assert.equal(resolved[1].items[0].id, 'AC-003');
});

test('resolveCollections unions across array items of multiple parents', () => {
  const doc = nestedDoc();
  const fr = resolveCollections(doc, 'functional_requirements[].acceptance_criteria');
  const nfr = resolveCollections(doc, 'non_functional_requirements[].acceptance_criteria');
  const ids = [...fr, ...nfr].flatMap((c) => c.items.map((item) => item.id));
  assert.deepEqual(ids, ['AC-001', 'AC-002', 'AC-003', 'AC-004']);
});

test('resolveCollections yields empty for an absent property and never errors', () => {
  const doc = nestedDoc();
  assert.deepEqual(resolveCollections(doc, 'missing_array'), []);
  assert.deepEqual(resolveCollections(doc, 'functional_requirements[].missing_nested'), []);
  assert.deepEqual(resolveCollections(doc, 'missing_parent[].acceptance_criteria'), []);
});

test('resolveCollections yields empty for an empty array and never errors', () => {
  const doc = { functional_requirements: [], problem_statement: 'x' };
  assert.deepEqual(resolveCollections(doc, 'functional_requirements'), []);
  assert.deepEqual(resolveCollections(doc, 'functional_requirements[].acceptance_criteria'), []);
});

test('resolveCollections yields empty when an iterated property is not an array', () => {
  const doc = { functional_requirements: 'not-an-array', other: [{ acceptance_criteria: [] }] };
  assert.deepEqual(resolveCollections(doc, 'functional_requirements[].acceptance_criteria'), []);
});

test('resolveLeafValues resolves a single-segment top-level string', () => {
  const doc = nestedDoc();
  const leaves = resolveLeafValues(doc, 'problem_statement');
  assert.deepEqual(leaves, [
    { value: 'Operators cannot register devices.', target: 'problem_statement' },
  ]);
});

test('resolveLeafValues resolves a two-segment leaf with indexed targets', () => {
  const doc = nestedDoc();
  const leaves = resolveLeafValues(doc, 'functional_requirements[].description');
  assert.deepEqual(leaves, [
    { value: 'The system shall create a device record.', target: 'functional_requirements[0].description' },
    { value: 'The system shall reject unknown devices.', target: 'functional_requirements[1].description' },
  ]);
});

test('resolveLeafValues resolves a three-segment leaf with full index chains', () => {
  const doc = nestedDoc();
  const leaves = resolveLeafValues(
    doc,
    'functional_requirements[].acceptance_criteria[].statement'
  );
  assert.deepEqual(leaves, [
    {
      value: 'Given none, When submitted, Then 201.',
      target: 'functional_requirements[0].acceptance_criteria[0].statement',
    },
    {
      value: 'Given duplicate, When submitted, Then 409.',
      target: 'functional_requirements[0].acceptance_criteria[1].statement',
    },
    {
      value: 'Given unknown, When queried, Then 404.',
      target: 'functional_requirements[1].acceptance_criteria[0].statement',
    },
  ]);
});

test('resolveLeafValues skips non-string leaves and absent properties without error', () => {
  const doc = { items: [{ note: 'kept' }, { note: 42 }, {}, { note: 'also kept' }] };
  const leaves = resolveLeafValues(doc, 'items[].note');
  assert.deepEqual(leaves, [
    { value: 'kept', target: 'items[0].note' },
    { value: 'also kept', target: 'items[3].note' },
  ]);
  assert.deepEqual(resolveLeafValues(doc, 'missing[].note'), []);
  assert.deepEqual(resolveLeafValues(doc, 'missing_scalar'), []);
});

test('single-segment specs are byte-identical with getTopArray', () => {
  const doc = nestedDoc();
  for (const name of [
    'functional_requirements',
    'non_functional_requirements',
    'missing_array',
    'problem_statement',
  ]) {
    assert.deepEqual(
      resolveCollections(doc, name).map((c) => c.items),
      [getTopArray(doc, name)].filter((items) => items.length > 0)
    );
  }
});

test('single-segment and two-segment leaf specs are byte-identical with resolvePath', () => {
  const doc = nestedDoc();
  // resolvePath is defined for single-segment specs and two-segment specs with
  // one [] marker; three-segment specs are new resolver behavior asserted above.
  for (const spec of [
    'problem_statement',
    'missing_scalar',
    'functional_requirements[].description',
    'non_functional_requirements[].description',
  ]) {
    assert.deepEqual(resolveLeafValues(doc, spec), resolvePath(doc, spec));
  }
});

test('resolution is deterministic: identical inputs produce identical outputs on repeated calls', () => {
  const doc = nestedDoc();
  const firstCollections = resolveCollections(
    doc,
    'functional_requirements[].acceptance_criteria'
  );
  const secondCollections = resolveCollections(
    doc,
    'functional_requirements[].acceptance_criteria'
  );
  assert.deepEqual(firstCollections, secondCollections);

  const firstLeaves = resolveLeafValues(
    doc,
    'functional_requirements[].acceptance_criteria[].statement'
  );
  const secondLeaves = resolveLeafValues(
    doc,
    'functional_requirements[].acceptance_criteria[].statement'
  );
  assert.deepEqual(firstLeaves, secondLeaves);
});
