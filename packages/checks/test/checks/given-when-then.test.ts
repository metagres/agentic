import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks } from '../../src/index.ts';

const run = checks['given-when-then'].run;

const GWT = 'Given a deployed system, When a request fails, Then the user sees an error';

test('accepts complete Given/When/Then statements', () => {
  assert.deepEqual(
    run({
      artifact: { scenarios: [{ id: 'S1', statement: GWT }] },
      params: { arrays: ['scenarios'] },
    }),
    []
  );
});

test('reports the missing keywords per statement', () => {
  const findings = run({
    artifact: { scenarios: [{ id: 'S1', statement: 'Given a system, When a request fails' }] },
    params: { arrays: ['scenarios'] },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'given-when-then');
  assert.equal(findings[0].category, 'ambiguity');
  assert.equal(findings[0].target, 'scenarios[0].statement');
  assert.ok(findings[0].finding.includes('missing keyword(s): then'));
});

test('matches keywords case-insensitively and as whole words', () => {
  assert.deepEqual(
    run({
      artifact: { scenarios: [{ statement: 'given x WHEN y tHen z' }] },
      params: { arrays: ['scenarios'] },
    }),
    []
  );
});

test('reports multiple missing keywords together', () => {
  const findings = run({
    artifact: { scenarios: [{ statement: 'it should work' }] },
    params: { arrays: ['scenarios'] },
  });

  const missing = findings[0].finding.match(/missing keyword\(s\): (.+)\./)![1].split(', ').sort();
  assert.deepEqual(missing, ['given', 'then', 'when']);
});

test('accepts a single string in arrays', () => {
  assert.deepEqual(
    run({ artifact: { scenarios: [{ statement: GWT }] }, params: { arrays: 'scenarios' } }),
    []
  );
});

test('resolves nested path specs and indexes targets', () => {
  const findings = run({
    artifact: { epics: [{ features: [{ statement: 'no keywords' }] }, { features: [{ statement: GWT }] }] },
    params: { arrays: ['epics[].features'] },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'epics[0].features[0].statement');
});

test('supports a custom statement_field', () => {
  const findings = run({
    artifact: { scenarios: [{ criterion: 'no keywords at all' }] },
    params: { arrays: ['scenarios'], statement_field: 'criterion' },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'scenarios[0].criterion');
});

test('an absent collection yields no findings', () => {
  assert.deepEqual(run({ artifact: {}, params: { arrays: ['scenarios'] } }), []);
});

test('missing required parameters abort the run', () => {
  assert.throws(
    () => run({ artifact: {} }),
    (err: Error) => err.message.includes('required parameter(s): arrays')
  );
});
