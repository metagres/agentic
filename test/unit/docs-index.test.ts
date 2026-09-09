import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDocsIndex, headingExists } from '../../src/scripts/lib/docs-index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

test('loadDocsIndex returns the sorted docs/current/*.md directory scan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-docs-index-'));
  writeTree(root, {
    'docs/current/operations.md': '# operations.md\n',
    'docs/current/api-contract.md': '# api-contract.md\n',
    'docs/current/architecture.md': '# architecture.md\n',
  });

  assert.deepEqual(loadDocsIndex(root).map((d) => d.file), [
    'docs/current/api-contract.md',
    'docs/current/architecture.md',
    'docs/current/operations.md',
  ]);
});

test('loadDocsIndex excludes non-.md entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-docs-index-'));
  writeTree(root, {
    'docs/current/glossary.md': '# glossary.md\n',
    'docs/current/notes.txt': 'not a document',
  });
  fs.mkdirSync(path.join(root, 'docs', 'current', 'assets'));

  const files = loadDocsIndex(root).map((d) => d.file);

  assert.deepEqual(files, ['docs/current/glossary.md']);
});

test('loadDocsIndex yields an empty list when docs/current is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-docs-index-'));

  assert.deepEqual(loadDocsIndex(root), []);
});

test('loadDocsIndex yields exactly the single .md document (boundary)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-docs-index-'));
  writeTree(root, { 'docs/current/decisions.md': '# decisions.md\n' });

  assert.deepEqual(loadDocsIndex(root), [{ file: 'docs/current/decisions.md' }]);
});

test('loadDocsIndex reads the real repository directory (9 documents after retirement)', () => {
  const docs = loadDocsIndex(REPO_ROOT);

  assert.equal(docs.length, 9, `expected exactly 9 documents, got ${docs.length}`);
  assert.ok(
    docs.some((d) => d.file === 'docs/current/architecture.md'),
    'directory scan should list docs/current/architecture.md'
  );
  const files = new Set(docs.map((d) => d.file));
  assert.ok(!files.has('docs/current/index.md'), 'retired index.md must not reappear');
});

test('headingExists validates Modify/Remove anchors against the target document', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-docs-index-'));
  writeTree(root, {
    'docs/current/architecture.md': '# architecture.md\n\n## Folder Responsibilities\n',
  });

  assert.ok(headingExists(root, 'docs/current/architecture.md', '## Folder Responsibilities'));
  assert.ok(!headingExists(root, 'docs/current/architecture.md', '## Missing'));
  assert.ok(!headingExists(root, 'docs/current/absent.md', '## Anything'));
});
