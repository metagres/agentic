import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSegments,
  renderSegments,
  replaceRegion,
  readRegion,
  requireRegions,
  regionIds,
  DocsGenError,
  regionBeginMarker,
  regionEndMarker,
} from '../../src/scripts/lib/docs-gen/splice.ts';
import {
  splitRow,
  renderTable,
  mergeTableRows,
  parseTableAt,
  tableRowsUnderHeading,
} from '../../src/scripts/lib/docs-gen/table.ts';

const DOC = [
  '# Title',
  '',
  '<!-- docs-gen:begin id="one" -->',
  'old one',
  '<!-- docs-gen:end id="one" -->',
  '',
  'middle prose',
  '',
  '<!-- docs-gen:begin id="two" -->',
  'old two',
  '<!-- docs-gen:end id="two" -->',
  '',
  'tail',
].join('\n');

test('parse/render round-trips byte-identically', () => {
  assert.equal(renderSegments(parseSegments(DOC), new Map()), DOC);
});

test('regions replace content while prose is preserved verbatim', () => {
  const next = renderSegments(parseSegments(DOC), new Map([['one', ['new one']]]));
  assert.ok(next.includes('new one'));
  assert.ok(!next.includes('old one'));
  assert.ok(next.includes('old two'));
  assert.ok(next.includes('middle prose'));
  assert.ok(next.includes(regionBeginMarker('one')));
  assert.ok(next.includes(regionEndMarker('one')));
});

test('repeated generation is idempotent', () => {
  const once = renderSegments(parseSegments(DOC), new Map([['one', ['stable']], ['two', ['stable']]]));
  const twice = renderSegments(parseSegments(once), new Map([['one', ['stable']], ['two', ['stable']]]));
  assert.equal(once, twice);
});

test('replacements for undeclared regions are rejected', () => {
  assert.throws(() => renderSegments(parseSegments(DOC), new Map([['nope', ['x']]])), /does not declare/);
});

test('malformed markers abort with named conditions', () => {
  assert.throws(() => parseSegments('<!-- docs-gen:end id="x" -->'), /no begin marker/);
  assert.throws(() => parseSegments('<!-- docs-gen:begin id="x" -->\nbody'), /never closed/);
  assert.throws(
    () => parseSegments('<!-- docs-gen:begin id="x" -->\n<!-- docs-gen:end id="y" -->'),
    /mismatched end marker/
  );
  assert.throws(
    () =>
      parseSegments(
        '<!-- docs-gen:begin id="x" -->\n<!-- docs-gen:begin id="y" -->'
      ),
    /not closed before a new begin marker/
  );
});

test('duplicate region ids are detectable and rejected by requireRegions', () => {
  const dup = [
    '<!-- docs-gen:begin id="x" -->',
    '<!-- docs-gen:end id="x" -->',
    '<!-- docs-gen:begin id="x" -->',
    '<!-- docs-gen:end id="x" -->',
  ].join('\n');
  assert.deepEqual(regionIds(DOC), ['one', 'two']);
  assert.throws(() => requireRegions(dup, ['x']), /2 times/);
  assert.throws(() => requireRegions(DOC, ['missing']), /does not declare required region/);
  requireRegions(DOC, ['one', 'two']);
});

test('replaceRegion and readRegion round-trip one region', () => {
  const next = replaceRegion(DOC, 'two', ['fresh', 'lines']);
  assert.deepEqual(readRegion(next, 'two'), ['fresh', 'lines']);
  assert.deepEqual(readRegion(next, 'one'), ['old one']);
});

test('readRegion returns preserved lines', () => {
  assert.deepEqual(readRegion(DOC, 'one'), ['old one']);
  assert.equal(readRegion(DOC, 'absent'), null);
});

test('splitRow honors escaped pipes', () => {
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
});

test('parseTableAt consumes header, separator, and rows', () => {
  const lines = '| Name | Version |'.split('\n').concat([
    '| --- | --- |',
    '| ajv | ^8 |',
    '',
    'after',
  ]);
  const parsed = parseTableAt(lines, 0);
  assert.ok(parsed);
  assert.deepEqual(parsed?.header, ['Name', 'Version']);
  assert.deepEqual(parsed?.rows, [['ajv', '^8']]);
});

test('renderTable is deterministic and escapes cells', () => {
  const once = renderTable(['Name', 'Notes'], [['ajv', 'a|b'], ['yaml', 'line1\nline2']]);
  const twice = renderTable(['Name', 'Notes'], [['ajv', 'a|b'], ['yaml', 'line1\nline2']]);
  assert.deepEqual(once, twice);
  assert.equal(once[0], '| Name | Notes |');
  assert.equal(once[1], '| --- | --- |');
  assert.ok(once.some((line) => line.includes('a\\|b')));
  assert.ok(once.some((line) => line.includes('line1 line2')));
});

test('mergeTableRows preserves judgment columns and agent-added rows', () => {
  const existing = [
    ['ajv', '^8.20.0', 'JSON Schema validation', 'src/scripts/lib/schema.ts'],
    ['legacy-only', '^1.0.0', 'agent-added row', 'somewhere'],
  ];
  const generated = [['ajv', '^8.21.0', '', 'src/scripts/lib/schema.ts, bin/x.ts']];
  const merged = mergeTableRows(existing, generated, { keyColumn: 0, preserveColumns: [2], sortBy: 0 });
  assert.deepEqual(merged, [
    ['ajv', '^8.21.0', 'JSON Schema validation', 'src/scripts/lib/schema.ts, bin/x.ts'],
    ['legacy-only', '^1.0.0', 'agent-added row', 'somewhere'],
  ]);
});

test('tableRowsUnderHeading finds the table below a heading', () => {
  const content = [
    '## Key Dependencies',
    '',
    '| Name | Version |',
    '| ---- | ------- |',
    '| yaml | ^2.5.1 |',
    '',
    '## Next',
  ].join('\n');
  assert.deepEqual(tableRowsUnderHeading(content, 'Key Dependencies'), [['yaml', '^2.5.1']]);
  assert.deepEqual(tableRowsUnderHeading(content, 'Missing'), []);
});

test('DocsGenError prefixes its message', () => {
  const err = new DocsGenError('boom');
  assert.equal(err.name, 'DocsGenError');
  assert.equal(err.message, 'docs-gen: boom');
});
