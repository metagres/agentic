import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveRootOrError,
  ResolveRootError,
  normalizeName,
} from '../../src/scripts/lib/resolve-root.ts';

const FIXTURE_DIRS = [
  'genericize-stage-engine',
  'add-auth-flow',
  'deploy-knowledge-init-as-a-second-skill-and-make-it-the-sole',
];

function makeChangesProject(dirs: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-resolve-'));
  const changes = path.join(root, 'docs', 'changes');
  fs.mkdirSync(changes, { recursive: true });
  for (const dir of dirs) {
    fs.mkdirSync(path.join(changes, dir), { recursive: true });
  }
  return root;
}

function changesDirOf(root: string): string {
  return path.join(root, 'docs', 'changes');
}

test('normalizeName collapses text to slug tokens', () => {
  assert.equal(normalizeName('Genericize the Stage Engine'), 'genericize-the-stage-engine');
  assert.equal(normalizeName('  Weird / Text !! '), 'weird-text');
  assert.equal(normalizeName(''), '');
});

test('case-insensitive exact match resolves', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.equal(
    resolveRootOrError('GENERICIZE-STAGE-ENGINE', { cwd: root }),
    path.join(changesDirOf(root), 'genericize-stage-engine')
  );
});

test('natural-language name resolves via normalized exact match', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.equal(
    resolveRootOrError('genericize stage engine', { cwd: root }),
    path.join(changesDirOf(root), 'genericize-stage-engine')
  );
});

test('token subset resolves a unique match', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.equal(
    resolveRootOrError('stage engine', { cwd: root }),
    path.join(changesDirOf(root), 'genericize-stage-engine')
  );
});

test('reordered tokens still resolve via token subset', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.equal(
    resolveRootOrError('engine stage', { cwd: root }),
    path.join(changesDirOf(root), 'genericize-stage-engine')
  );
});

test('a single token resolves when it appears in exactly one entry', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.equal(
    resolveRootOrError('genericize', { cwd: root }),
    path.join(changesDirOf(root), 'genericize-stage-engine')
  );
});

test('a token prefix resolves via normalized substring', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.equal(
    resolveRootOrError('generic', { cwd: root }),
    path.join(changesDirOf(root), 'genericize-stage-engine')
  );
});

test('a name matching two dirs throws ambiguous with both candidates', () => {
  const root = makeChangesProject([...FIXTURE_DIRS, 'auth-flow-v2']);

  assert.throws(
    () => resolveRootOrError('auth flow', { cwd: root }),
    (err: unknown) => {
      assert.ok(err instanceof ResolveRootError);
      assert.equal((err as ResolveRootError).candidates.length, 2);
      assert.deepEqual(
        (err as ResolveRootError).candidates.slice().sort(),
        ['add-auth-flow', 'auth-flow-v2']
      );
      return true;
    }
  );
});

test('not-found carries available changes and the searched path', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.throws(
    () => resolveRootOrError('nonexistent', { cwd: root }),
    (err: unknown) => {
      assert.ok(err instanceof ResolveRootError);
      const resolveErr = err as ResolveRootError;
      assert.deepEqual(resolveErr.available, [...FIXTURE_DIRS].sort());
      assert.equal(resolveErr.searched, changesDirOf(root));
      assert.match(resolveErr.message, /No change directory matching 'nonexistent'\./);
      assert.ok(resolveErr.message.includes('Available changes:'));
      return true;
    }
  );
});

test('cwd without docs/changes is authoritative — no ancestor or script-dir inference', () => {
  const root = makeChangesProject(FIXTURE_DIRS);
  const nested = path.join(root, 'sub', 'nested');
  fs.mkdirSync(nested, { recursive: true });

  assert.throws(
    () => resolveRootOrError('nonexistent', { cwd: nested }),
    (err: unknown) => {
      assert.ok(err instanceof ResolveRootError);
      const resolveErr = err as ResolveRootError;
      // The cwd is the project root; an ancestor's docs/changes (or the CLI
      // script's own location) must not be suggested or used.
      assert.equal(resolveErr.searched, path.join(nested, 'docs', 'changes'));
      assert.deepEqual(resolveErr.available, []);
      assert.match(resolveErr.message, /docs\/changes does not exist under/);
      assert.ok(
        resolveErr.message.includes('Create a change directory first.'),
        resolveErr.message
      );
      return true;
    }
  );
});

test('an explicit docs/changes path resolves', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.equal(
    resolveRootOrError('docs/changes/genericize-stage-engine', { cwd: root }),
    path.join(changesDirOf(root), 'genericize-stage-engine')
  );
});

test('a path outside the repo cwd is refused', () => {
  const root = makeChangesProject(FIXTURE_DIRS);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-resolve-outside-'));
  const rel = path.relative(root, outside);

  assert.ok(rel.startsWith('..'), `expected a relative path outside the cwd, got '${rel}'`);

  assert.throws(
    () => resolveRootOrError(rel, { cwd: root }),
    /Refusing to use a directory outside the repository/
  );
});

test('empty string throws a usage error', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.throws(
    () => resolveRootOrError('', { cwd: root }),
    /A change directory or slug is required\./
  );
});
