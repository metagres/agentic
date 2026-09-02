import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { changesDirFor, resolveRootOrError, ResolveRootError } from '../../src/scripts/lib/resolve-root.ts';
import { resolveCwd } from '../../src/scripts/lib/cli.ts';

const FIXTURE_DIRS = ['genericize-stage-engine', 'add-auth-flow'];

function makeChangesProject(dirs: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-cwd-'));
  const changes = path.join(root, 'docs', 'changes');
  fs.mkdirSync(changes, { recursive: true });
  for (const dir of dirs) {
    fs.mkdirSync(path.join(changes, dir), { recursive: true });
  }
  return root;
}

test('changesDirFor is the single <root>/docs/changes constructor', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.equal(changesDirFor(root), path.join(root, 'docs', 'changes'));
});

test('resolveCwd defaults to process.cwd() and resolves the --cwd override', () => {
  assert.equal(resolveCwd({}), process.cwd());
  assert.equal(resolveCwd({ cwd: true }), path.resolve('true'));

  const absolute = makeChangesProject(FIXTURE_DIRS);
  assert.equal(resolveCwd({ cwd: absolute }), path.resolve(absolute));

  const relative = path.relative(process.cwd(), absolute);
  assert.equal(resolveCwd({ cwd: relative }), absolute);
});

test('scenario 1: resolves from a project root', () => {
  const root = makeChangesProject(FIXTURE_DIRS);

  assert.equal(
    resolveRootOrError('genericize-stage-engine', { cwd: root }),
    path.join(changesDirFor(root), 'genericize-stage-engine')
  );
});

test('scenario 2: fails from a directory without docs/changes with the actionable message and searched path', () => {
  const root = makeChangesProject(FIXTURE_DIRS);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-cwd-bare-'));

  assert.throws(
    () => resolveRootOrError('genericize-stage-engine', { cwd: bare }),
    (err: unknown) => {
      assert.ok(err instanceof ResolveRootError);
      const resolveErr = err as ResolveRootError;
      assert.equal(resolveErr.searched, changesDirFor(bare));
      assert.deepEqual(resolveErr.available, []);
      // The e2e-asserted prefix plus the searched path and both remedies.
      assert.match(
        resolveErr.message,
        new RegExp(`docs/changes does not exist under ${bare.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`)
      );
      assert.ok(resolveErr.message.includes(`(searched: ${changesDirFor(bare)})`));
      assert.ok(
        resolveErr.message.includes(
          'Run from the project root or pass the root explicitly with --cwd <project-root>.'
        )
      );
      assert.ok(!resolveErr.message.includes('Create a change first'));
      return true;
    }
  );
});

test('scenario 3: resolves via the cwd option override from any directory', () => {
  const root = makeChangesProject(FIXTURE_DIRS);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-cwd-elsewhere-'));

  // The override root resolves exactly as if invoked from the project root.
  assert.equal(
    resolveRootOrError('add-auth-flow', { cwd: resolveCwd({ cwd: root }) }),
    path.join(changesDirFor(root), 'add-auth-flow')
  );
  assert.notEqual(elsewhere, root);
});

test('scenario 4: fails naming a nonexistent override root', () => {
  const invalid = path.join(os.tmpdir(), 'agentic-cwd-missing', 'no-such-root');

  assert.throws(
    () => resolveRootOrError('genericize-stage-engine', { cwd: resolveCwd({ cwd: invalid }) }),
    (err: unknown) => {
      assert.ok(err instanceof ResolveRootError);
      const resolveErr = err as ResolveRootError;
      // The override-provided path is named as the searched root.
      assert.equal(resolveErr.searched, changesDirFor(path.resolve(invalid)));
      assert.match(resolveErr.message, /docs\/changes does not exist under/);
      assert.ok(resolveErr.message.includes(path.resolve(invalid)));
      return true;
    }
  );
});

test('scenario 5: never walks up ancestor directories', () => {
  const root = makeChangesProject(FIXTURE_DIRS);
  const nested = path.join(root, 'sub', 'nested');
  fs.mkdirSync(nested, { recursive: true });

  // The ancestor root has docs/changes with the fixture, but resolution from
  // the nested directory must not find it.
  assert.throws(
    () => resolveRootOrError('genericize-stage-engine', { cwd: nested }),
    (err: unknown) => {
      assert.ok(err instanceof ResolveRootError);
      const resolveErr = err as ResolveRootError;
      assert.equal(resolveErr.searched, changesDirFor(nested));
      assert.match(resolveErr.message, /docs\/changes does not exist under/);
      return true;
    }
  );
});
