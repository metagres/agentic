import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { validRequirements } from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function makeTmpProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-hist-'));
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'index.md'),
    [
      '# Current Docs Index',
      '| File | Purpose | When to Read | Notes |',
      '|---|---|---|---|',
      '| docs/current/architecture.md | Tech stack, boundaries, folder responsibilities | Structural changes | Fixture |',
      '| docs/current/api-contract.md | Endpoints: method, path, auth, shapes | API changes | Fixture |',
      '| docs/current/glossary.md | Entities, fields, relationships, rules | Data layer changes | Fixture |',
      '| docs/current/capabilities.md | Features, workflows, user journeys | Feature changes | Fixture |',
      '| docs/current/conventions.md | Patterns, naming, error handling, file org | Code writing | Fixture |',
      '| docs/current/operations.md | Build, test, lint, deploy, env vars | Verification | Fixture |',
      '| docs/current/dependencies.md | Key libraries and roles | Dependency changes | Fixture |',
      '| docs/current/known-issues.md | Markers, skipped tests | Task estimation | Fixture |',
      '| docs/current/decisions.md | ADRs (reference) + cycle decisions (living) | Architectural changes | Fixture |',
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
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('plain review records by default and dry-run does not', () => {
  const tmp = makeTmpProject();

  let out = run(tmp, ['requirements', '--request', 'Add profile']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  const artifact = validRequirements({ request: 'Add profile' });
  out = run(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete');

  // Bare invocation appends an open round (open-to-closed lifecycle).
  out = run(tmp, ['requirements-review', '--change', changeDir]);
  assert.equal(out.data.round, 1);

  let rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);
  assert.equal(rev.rounds[0].status, 'open');
  assert.equal(rev.rounds[0].decision, 'review');

  // A second bare invocation refreshes the same round number in place.
  out = run(tmp, ['requirements-review', '--change', changeDir]);
  assert.equal(out.data.round, 1);
  rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);
  assert.equal(rev.rounds[0].round, 1);
  assert.equal(rev.rounds[0].status, 'open');

  out = run(tmp, [
    'requirements-review',
    '--change',
    changeDir,
    '--dry-run',
  ]);
  assert.equal(out.data.dry_run, true);
  assert.equal(out.data.round, null);

  rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);

  // A verdict completes the open round in place instead of appending.
  out = run(tmp, [
    'requirements-review',
    '--change',
    changeDir,
    '--reject',
    '--note',
    'Needs a narrower scope.',
  ]);
  assert.equal(out.data.round, 1);

  rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);
  assert.equal(rev.rounds[0].round, 1);
  assert.equal(rev.rounds[0].decision, 'rejected');
  assert.equal(rev.rounds[0].status, 'closed');
  assert.equal(rev.rounds[0].rationale, 'Needs a narrower scope.');
});