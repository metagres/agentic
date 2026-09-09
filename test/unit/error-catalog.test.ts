import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../../src/scripts/lib/yaml-io.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ERRORS_YAML = path.join(REPO_ROOT, 'src', 'policies', 'errors.yaml');

interface CatalogRow {
  message: string;
  fix: string;
}

const catalog = readYaml(ERRORS_YAML) as { errors: Record<string, CatalogRow> };

test('DOCS_CURRENT_MISSING carries the reworded message and a fix text', () => {
  const row = catalog.errors.DOCS_CURRENT_MISSING;
  assert.ok(row, 'DOCS_CURRENT_MISSING must exist in the catalog');
  assert.equal(row.message, 'docs/current not found; delta target validation was skipped.');
  assert.ok(typeof row.fix === 'string' && row.fix.trim().length > 0, 'fix text is required');
  assert.ok(!row.fix.includes('index.md'), 'the fix must not cite the retired page');
});

test('zero DOCS_INDEX_MISSING occurrences remain in the catalog (invariant 5)', () => {
  assert.equal(catalog.errors.DOCS_INDEX_MISSING, undefined);
  const raw = fs.readFileSync(ERRORS_YAML, 'utf8');
  assert.ok(!raw.includes('DOCS_INDEX_MISSING'), 'DOCS_INDEX_MISSING must be fully retired');
});
