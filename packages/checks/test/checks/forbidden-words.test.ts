import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks } from '../../src/index.ts';

const run = checks['forbidden-words'].run;

test('the default profile flags forbidden words in a top-level field', () => {
  const findings = run({
    artifact: { summary: 'The system is simple to use.' },
    params: { fields: ['summary'] },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'forbidden-word');
  assert.equal(findings[0].category, 'ambiguity');
  assert.equal(findings[0].target, 'summary');
  assert.equal(findings[0].finding, '"simple" is a forbidden word in summary.');
  assert.ok(findings[0].fix!.includes('concrete metric'));
});

test('matching is whole-word and case-insensitive', () => {
  const findings = run({
    artifact: { summary: 'This is SIMPLE.' },
    params: { fields: ['summary'] },
  });

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('"simple"'));
});

test('phrases with spaces are matched as whole phrases', () => {
  const findings = run({
    artifact: { summary: 'The system works, and it works well.' },
    params: { fields: ['summary'] },
  });

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('"it works"'));
});

test('scans nested leaf fields through path specs', () => {
  const findings = run({
    artifact: { sections: [{ notes: 'an easy change' }, { notes: 'all good' }] },
    params: { fields: ['sections[].notes'] },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'sections[0].notes');
});

test('a per-field forbidden list overrides the shared profile', () => {
  const findings = run({
    artifact: { summary: 'simple and urgent' },
    params: { fields: [{ path: 'summary', forbidden: ['urgent'] }] },
  });

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('"urgent"'));
  assert.ok(!findings[0].finding.includes('simple'));
});

test('params.forbidden replaces the default word list globally', () => {
  const findings = run({
    artifact: { a: 'simple', b: 'robust', c: 'quick' },
    params: { fields: ['a', 'b', 'c'], forbidden: ['quick'] },
  });

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('"quick"'));
  assert.equal(findings[0].target, 'c');
});

test('only the first matching word per value is reported', () => {
  const findings = run({
    artifact: { summary: 'simple, robust, easy' },
    params: { fields: ['summary'] },
  });

  assert.equal(findings.length, 1);
});

test('values without forbidden words produce no findings', () => {
  assert.deepEqual(
    run({
      artifact: { summary: 'completes in under 200 ms' },
      params: { fields: ['summary'] },
    }),
    []
  );
});

test('an absent field yields no findings', () => {
  assert.deepEqual(run({ artifact: {}, params: { fields: ['missing'] } }), []);
});

test('missing required parameters abort the run', () => {
  assert.throws(
    () => run({ artifact: {} }),
    (err: Error) => err.message.includes('required parameter(s): fields')
  );
});
