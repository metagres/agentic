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

  // Bare invocation appends an open round (merged status lifecycle).
  out = run(tmp, ['requirements-review', '--change', changeDir]);
  assert.equal(out.data.round, 1);
  assert.equal(out.data.status, 'open');

  let rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);
  assert.equal(rev.rounds[0].status, 'open');
  assert.equal(rev.rounds[0].mechanical_checks_passed, true);
  assert.deepEqual(rev.rounds[0].failures, []);

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
  const checks = readYaml(
    path.join(root, 'src', 'stages', 'requirements', 'semantic-checks.yaml')
  ).checks;
  const failures = path.join(tmp, 'failures.yaml');
  fs.writeFileSync(
    failures,
    `- check: ${JSON.stringify(checks[0])}\n  evidence: "The failure paths are not specified."\n`,
    'utf8'
  );
  out = run(tmp, [
    'requirements-review',
    '--change',
    changeDir,
    '--reject',
    '--failures',
    failures,
  ]);
  assert.equal(out.data.round, 1);
  assert.equal(out.data.status, 'rejected');

  rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);
  assert.equal(rev.rounds[0].round, 1);
  assert.equal(rev.rounds[0].status, 'rejected');
  assert.equal(rev.metadata.latest_status, 'rejected');
  assert.equal(rev.rounds[0].semantic_checks_passed, false);
  assert.equal(rev.rounds[0].failures.length, 1);
  assert.equal(rev.rounds[0].failures[0].check, checks[0]);
});
