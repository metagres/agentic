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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-rej-'));
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
    input,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('reject then recover preserves history and bumps version', () => {
  const tmp = makeTmpProject();
  let out = run(tmp, ['requirements', '--request', 'Add login']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  out = run(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request: 'Add login' }))
  );
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['requirements-review', '--change', changeDir, '--reject']);
  assert.equal(out.state, 'blocked', JSON.stringify(out));

  let req = readYaml(path.join(changeRoot, 'requirements.yaml'));
  assert.equal(req.metadata.status, 'rejected');
  const v1 = req.metadata.version;

  let rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);
  assert.equal(rev.rounds[0].decision, 'rejected');

  out = run(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ title: 'Add login recovered', request: 'Add login' }))
  );
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['requirements-review', '--change', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  req = readYaml(path.join(changeRoot, 'requirements.yaml'));
  assert.equal(req.metadata.status, 'accepted');
  assert.notEqual(req.metadata.version, v1);

  rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 2);
  assert.deepEqual(rev.rounds.map((r) => r.decision), ['rejected', 'accepted']);
});