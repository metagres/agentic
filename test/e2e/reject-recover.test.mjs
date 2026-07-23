import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../../src/scripts/lib/yaml-io.mjs';
import { validRequirements, semanticResults } from '../helpers/artifacts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.mjs');

function makeTmpProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-rej-'));
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'index.md'),
    '# Current Docs Index\n| File | Purpose | When to Read | Notes |\n|---|---|---|---|\n| docs/current/overview.md | System overview | Start here | Fixture |\n',
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
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request: 'Add login', semantic: semanticResults(root, 'requirements') }))
  );
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['requirements', '--dir', changeDir, '--finalize']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['review', '--target', 'requirements', '--dir', changeDir, '--reject']);
  assert.equal(out.state, 'blocked', JSON.stringify(out));

  let req = readYaml(path.join(changeRoot, 'requirements.yaml'));
  assert.equal(req.metadata.status, 'rejected');
  const v1 = req.metadata.version;

  let rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);
  assert.equal(rev.rounds[0].decision, 'rejected');

  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ title: 'Add login recovered', request: 'Add login', semantic: semanticResults(root, 'requirements') }))
  );
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['requirements', '--dir', changeDir, '--finalize']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['review', '--target', 'requirements', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  req = readYaml(path.join(changeRoot, 'requirements.yaml'));
  assert.equal(req.metadata.status, 'accepted');
  assert.notEqual(req.metadata.version, v1);

  rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 2);
  assert.deepEqual(rev.rounds.map((r) => r.decision), ['rejected', 'accepted']);
});
