import test from 'node:test';
import assert from 'node:assert/strict';

import { dedupeDeltas } from '../../src/scripts/lib/kinds/aggregator.ts';

type Delta = Record<string, unknown>;

function delta(overrides: Delta): Delta {
  return {
    target_doc: 'docs/current/architecture.md',
    change: 'Modify',
    reason: 'Placeholder reason that is long enough.',
    stage: 'requirements',
    ...overrides,
  };
}

test('same-doc Modify entries collapse to one and the latest stage reason survives', () => {
  const input = [
    delta({ stage: 'requirements', reason: 'requirements-stage framing of the edit.' }),
    delta({ stage: 'design', reason: 'design-stage refinement of the same edit.' }),
    delta({ stage: 'planning', reason: 'planning-stage final wording of the edit.' }),
  ];

  const result = dedupeDeltas(input);

  assert.equal(result.length, 1);
  assert.equal(result[0].stage, 'planning');
  assert.equal(result[0].reason, 'planning-stage final wording of the edit.');
  assert.equal(result[0].target_doc, 'docs/current/architecture.md');
  assert.equal(result[0].change, 'Modify');
});

test('same target_doc with different change types stays separate', () => {
  const input = [
    delta({ change: 'Add', stage: 'requirements', reason: 'Add the section once.' }),
    delta({ change: 'Modify', stage: 'design', reason: 'Modify the same section later.' }),
    delta({ change: 'Remove', stage: 'planning', reason: 'Remove a sibling section.' }),
  ];

  const result = dedupeDeltas(input);

  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((d) => d.change),
    ['Add', 'Modify', 'Remove']
  );
});

test('distinct non-null anchors on the same doc+change are preserved as separate entries', () => {
  const input = [
    delta({
      stage: 'requirements',
      target_anchor: '## Registration Flow',
      reason: 'Edit the registration flow section.',
    }),
    delta({
      stage: 'design',
      target_anchor: '## Device Lifecycle',
      reason: 'Edit the device lifecycle section.',
    }),
    // A later stage restates the first anchored edit: it wins within its anchor.
    delta({
      stage: 'planning',
      target_anchor: '## Registration Flow',
      reason: 'Final wording for the registration flow section.',
    }),
  ];

  const result = dedupeDeltas(input);

  assert.equal(result.length, 2);
  const byAnchor = new Map(result.map((d) => [d.target_anchor, d]));
  assert.equal(byAnchor.size, 2);
  assert.equal(byAnchor.get('## Registration Flow')?.reason, 'Final wording for the registration flow section.');
  assert.equal(byAnchor.get('## Device Lifecycle')?.reason, 'Edit the device lifecycle section.');
});

test('output order is deterministic: target_doc, then change, then stage', () => {
  const input = [
    delta({ target_doc: 'docs/current/glossary.md', change: 'Add', stage: 'design' }),
    delta({ target_doc: 'docs/current/api-contract.md', change: 'Modify', stage: 'planning' }),
    delta({ target_doc: 'docs/current/architecture.md', change: 'Remove', stage: 'requirements' }),
    delta({ target_doc: 'docs/current/architecture.md', change: 'Add', stage: 'design' }),
    // Later entry wins within the architecture+Add group, regardless of stage name.
    delta({ target_doc: 'docs/current/architecture.md', change: 'Add', stage: 'requirements' }),
  ];

  const result = dedupeDeltas(input);

  assert.deepEqual(
    result.map((d) => [d.target_doc, d.change, d.stage]),
    [
      ['docs/current/api-contract.md', 'Modify', 'planning'],
      ['docs/current/architecture.md', 'Add', 'requirements'],
      ['docs/current/architecture.md', 'Remove', 'requirements'],
      ['docs/current/glossary.md', 'Add', 'design'],
    ]
  );

  // Deterministic: identical input always yields an identical output sequence.
  assert.deepEqual(dedupeDeltas(input), result);
});

test('empty input passes through as an empty list', () => {
  assert.deepEqual(dedupeDeltas([]), []);
});
