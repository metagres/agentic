import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../../src/scripts/lib/yaml-io.mjs';
import {
  validRequirements,
  semanticResults,
} from '../helpers/artifacts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.mjs');

function makeTmpProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-hist-'));
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'index.md'),
    [
      '# Current Docs Index',
      '| File | Purpose | When to Read | Notes |',
      '|---|---|---|---|',
      '| docs/current/overview.md | System overview | Start here | Fixture |',
      '',
    ].join('\n'),
    'utf8'
  );
  return tmp;
}

function run(tmp, args, input) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input: input !== undefined ? input : undefined,
    timeout: 30000,
  });
  const detail = [
    `cmd: sdlc ${args.join(' ')}`,
    `exit=${res.status}`,
    `signal=${res.signal}`,
    `stderr: ${res.stderr || '(empty)'}`,
    `stdout: ${(res.stdout || '').slice(0, 800) || '(empty)'}`,
  ].join('\n');
  assert.ok(
    res.stdout && res.stdout.trim(),
    `CLI produced no stdout.\n${detail}`
  );
  let json;
  try {
    json = JSON.parse(res.stdout);
  } catch (e) {
    assert.fail(`CLI stdout is not valid JSON.\n${detail}\nParse error: ${e.message}`);
  }
  return json;
}

test('plain review records by default and dry-run does not', () => {
  const tmp = makeTmpProject();

  // 1. Create a change via --request
  let out = run(tmp, ['requirements', '--request', 'Add profile']);
  assert.ok(out.data.change_root, `No change_root in output: ${JSON.stringify(out)}`);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  // 2. Write a valid artifact through --update-artifact (stdin)
  const artifact = validRequirements({
    request: 'Add profile',
    semantic: semanticResults(root, 'requirements'),
  });
  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  assert.notEqual(out.state, 'blocked', `update-artifact blocked: ${JSON.stringify(out)}`);

  // 3. Finalize
  out = run(tmp, ['requirements', '--dir', changeDir, '--finalize']);
  assert.equal(out.state, 'complete', `finalize failed: ${JSON.stringify(out)}`);

  // 4. Plain review — should record round 1
  out = run(tmp, ['review', '--target', 'requirements', '--dir', changeDir]);
  assert.equal(out.data.round, 1, `Expected round 1: ${JSON.stringify(out)}`);

  let rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.ok(rev, 'requirements-review.yaml should exist after plain review');
  assert.equal(rev.rounds.length, 1, `Expected 1 round, got ${rev.rounds.length}`);

  // 5. Dry-run review — should NOT record another round
  out = run(tmp, [
    'review',
    '--target',
    'requirements',
    '--dir',
    changeDir,
    '--dry-run',
  ]);
  assert.equal(out.data.dry_run, true, `Expected dry_run=true: ${JSON.stringify(out)}`);
  assert.equal(out.data.round, null, `Expected round=null for dry-run: ${JSON.stringify(out)}`);

  rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(
    rev.rounds.length,
    1,
    `Dry-run should not add a round. Got ${rev.rounds.length}`
  );
});