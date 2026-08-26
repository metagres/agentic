import test from 'node:test';
import assert from 'node:assert/strict';

import { dedupeDeltas } from '../../src/scripts/lib/kinds/aggregator.ts';

type Delta = Record<string, unknown>;

function delta(overrides: Delta): Delta {
  return {
    target_doc: 'docs/current/architecture.md',
    change: 'Modify',
    reason: 'Placeholder reason that is long enough.',
    phase: 'Requirements',
    ...overrides,
  };
}

test('three-phase same-doc Modify collapses to one entry and the latest phase reason survives', () => {
  const input = [
    delta({ phase: 'Requirements', reason: 'Requirements-phase framing of the edit.' }),
    delta({ phase: 'Design', reason: 'Design-phase refinement of the same edit.' }),
    delta({ phase: 'Planning', reason: 'Planning-phase final wording of the edit.' }),
  ];

  const result = dedupeDeltas(input);

  assert.equal(result.length, 1);
  assert.equal(result[0].phase, 'Planning');
  assert.equal(result[0].reason, 'Planning-phase final wording of the edit.');
  assert.equal(result[0].target_doc, 'docs/current/architecture.md');
  assert.equal(result[0].change, 'Modify');
});

test('same target_doc with different change types stays separate', () => {
  const input = [
    delta({ change: 'Add', phase: 'Requirements', reason: 'Add the section once.' }),
    delta({ change: 'Modify', phase: 'Design', reason: 'Modify the same section later.' }),
    delta({ change: 'Remove', phase: 'Planning', reason: 'Remove a sibling section.' }),
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
      phase: 'Requirements',
      target_anchor: '## Registration Flow',
      reason: 'Edit the registration flow section.',
    }),
    delta({
      phase: 'Design',
      target_anchor: '## Device Lifecycle',
      reason: 'Edit the device lifecycle section.',
    }),
    // A later phase restates the first anchored edit: it wins within its anchor.
    delta({
      phase: 'Planning',
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

test('output order is deterministic: target_doc, then change, then phase', () => {
  const input = [
    delta({ target_doc: 'docs/current/glossary.md', change: 'Add', phase: 'Design' }),
    delta({ target_doc: 'docs/current/api-contract.md', change: 'Modify', phase: 'Planning' }),
    delta({ target_doc: 'docs/current/architecture.md', change: 'Remove', phase: 'Requirements' }),
    delta({ target_doc: 'docs/current/architecture.md', change: 'Add', phase: 'Design' }),
    // Later entry wins within the architecture+Add group, regardless of phase name.
    delta({ target_doc: 'docs/current/architecture.md', change: 'Add', phase: 'Requirements' }),
  ];

  const result = dedupeDeltas(input);

  assert.deepEqual(
    result.map((d) => [d.target_doc, d.change, d.phase]),
    [
      ['docs/current/api-contract.md', 'Modify', 'Planning'],
      ['docs/current/architecture.md', 'Add', 'Requirements'],
      ['docs/current/architecture.md', 'Remove', 'Requirements'],
      ['docs/current/glossary.md', 'Add', 'Design'],
    ]
  );

  // Deterministic: identical input always yields an identical output sequence.
  assert.deepEqual(dedupeDeltas(input), result);
});

test('empty input passes through as an empty list', () => {
  assert.deepEqual(dedupeDeltas([]), []);
});
