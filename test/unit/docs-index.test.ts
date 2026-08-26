import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDocsIndex, loadDocsIndex } from '../../src/scripts/lib/docs-index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('parseDocsIndex normalizes bare filenames to docs/current/ keys', () => {
  const content = [
    '| architecture.md | Tech stack and boundaries | Structural changes | Maintained |',
  ].join('\n');

  const docs = parseDocsIndex(content);

  assert.equal(docs.length, 1);
  assert.equal(docs[0].file, 'docs/current/architecture.md');
  assert.equal(docs[0].purpose, 'Tech stack and boundaries');
  assert.equal(docs[0].when, 'Structural changes');
  assert.equal(docs[0].notes, 'Maintained');
});

test('parseDocsIndex keeps prefixed docs/current/ rows unchanged', () => {
  const content = [
    '| docs/current/glossary.md | Entities and rules | Data layer changes | Maintained |',
  ].join('\n');

  const docs = parseDocsIndex(content);

  assert.equal(docs.length, 1);
  assert.equal(docs[0].file, 'docs/current/glossary.md');
  assert.equal(docs[0].purpose, 'Entities and rules');
});

test('parseDocsIndex yields every row in a mixed table', () => {
  const content = [
    '| architecture.md | Bare form |',
    '|------|---------|',
    '| docs/current/api-contract.md | Prefixed form |',
    '| glossary.md | Another bare form |',
  ].join('\n');

  const docs = parseDocsIndex(content);

  assert.deepEqual(
    docs.map((d) => d.file),
    [
      'docs/current/architecture.md',
      'docs/current/api-contract.md',
      'docs/current/glossary.md',
    ]
  );
});

test('parseDocsIndex excludes header and noise rows', () => {
  const content = [
    '# Heading outside any table',
    '',
    'Plain prose line that is not a table row.',
    '',
    '| File | Purpose |',
    '|------|---------|',
    '| conventions.md | Patterns and naming |',
    '| # | Check | Result |',
    '| 1 | Glossary entity with no API endpoint | None |',
    '| 7 | Decision referencing a technology not in tech stack | None |',
    '| Note | Location | Detail |',
    '| STALE-REF | src/policies/errors.yaml | See known-issues.md |',
    '| operations.md | Build and test commands |',
  ].join('\n');

  const docs = parseDocsIndex(content);

  // Only rows whose first cell ends with '.md' are kept; header and noise
  // rows of auxiliary tables are dropped instead of becoming pseudo-docs.
  assert.deepEqual(
    docs.map((d) => d.file),
    [
      'docs/current/conventions.md',
      'docs/current/operations.md',
    ]
  );
});

test('loadDocsIndex reads the real repository index', () => {
  const docs = loadDocsIndex(REPO_ROOT);

  assert.equal(docs.length, 9, `expected exactly 9 documents, got ${docs.length}`);
  assert.ok(
    docs.some((d) => d.file === 'docs/current/architecture.md'),
    'real index should list docs/current/architecture.md'
  );

  const files = new Set(docs.map((d) => d.file));
  assert.ok(!files.has('docs/current/File'), 'header row must not leak as a pseudo-doc');
  assert.ok(!files.has('docs/current/#'), 'cross-check header row must not leak as a pseudo-doc');
});
