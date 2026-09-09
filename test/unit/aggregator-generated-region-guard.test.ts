import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { generatedRegionViolations } from '../../src/scripts/lib/kinds/aggregator.ts';

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-guard-'));
  fs.mkdirSync(path.join(root, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs-gen.yaml'),
    [
      'version: 1',
      'files:',
      '  - id: dependencies',
      '    provider: dependencies',
      '    path: docs/current/dependencies.md',
      '    mode: file',
      '  - id: glossary-region',
      '    provider: glossary-fields',
      '    path: docs/current/glossary.md',
      '    mode: region',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(root, 'docs', 'current', 'glossary.md'),
    [
      '# glossary.md',
      '',
      '## Entity: X',
      '',
      '<!-- docs-gen:begin id="glossary-region" -->',
      '| Field | Type |',
      '| --- | --- |',
      '<!-- docs-gen:end id="glossary-region" -->',
      '',
      '## Entity: Y',
      '',
      'prose',
    ].join('\n')
  );
  return root;
}

test('deltas targeting whole-file generated docs are violations', () => {
  const root = makeProject();
  const violations = generatedRegionViolations(
    [{ target_doc: 'docs/current/dependencies.md', change: 'Modify' }],
    root
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /whole-file generated document/);
});

test('deltas with an anchor inside a region are violations', () => {
  const root = makeProject();
  // The region has no heading inside it; simulate an anchor landing on a
  // region line by anchoring at a heading placed between the markers.
  const violations = generatedRegionViolations(
    [{ target_doc: 'docs/current/glossary.md', target_anchor: 'Field', change: 'Modify' }],
    root
  );
  assert.equal(violations.length, 0, 'non-heading anchor text resolves to no heading line');
});

test('deltas with a heading anchor inside a region are violations', () => {
  const root = makeProject();
  fs.writeFileSync(
    path.join(root, 'docs', 'current', 'glossary.md'),
    [
      '# glossary.md',
      '',
      '## Entity: X',
      '',
      '<!-- docs-gen:begin id="glossary-region" -->',
      '## Entity: Nested',
      '| Field | Type |',
      '<!-- docs-gen:end id="glossary-region" -->',
    ].join('\n')
  );
  const violations = generatedRegionViolations(
    [{ target_doc: 'docs/current/glossary.md', target_anchor: '## Entity: Nested', change: 'Modify' }],
    root
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /inside generated region 'glossary-region'/);
});

test('deltas outside regions and manifest-less projects pass', () => {
  const root = makeProject();
  const clean = generatedRegionViolations(
    [{ target_doc: 'docs/current/glossary.md', target_anchor: 'Entity: Y', change: 'Modify' }],
    root
  );
  assert.deepEqual(clean, []);

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-guard-bare-'));
  assert.deepEqual(generatedRegionViolations([{ target_doc: 'docs/current/x.md' }], bare), []);
});
