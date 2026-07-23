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
  validDesign,
  validPlan,
  semanticResults,
} from '../helpers/artifacts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.mjs');

function makeTmpProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-full-'));
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

test('full pipeline requirements -> knowledge extraction complete', () => {
  const tmp = makeTmpProject();

  let out = run(tmp, ['requirements', '--request', 'Add device registration']);
  const changeRoot = out.data.change_root;
  assert.ok(changeRoot, JSON.stringify(out));
  const changeDir = path.basename(changeRoot);

  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ semantic: semanticResults(root, 'requirements') }))
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['requirements', '--dir', changeDir, '--finalize']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['review', '--target', 'requirements', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const req = readYaml(path.join(changeRoot, 'requirements.yaml'));
  const reqVersion = req.metadata.version;

  out = run(
    tmp,
    ['design', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(validDesign({ reqVersion, semantic: semanticResults(root, 'design') }))
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['design', '--dir', changeDir, '--finalize']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['review', '--target', 'design', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const des = readYaml(path.join(changeRoot, 'design.yaml'));
  const desVersion = des.metadata.version;

  const planSemantic = [
    ...semanticResults(root, 'plan'),
    ...semanticResults(root, 'implementation'),
  ];
  out = run(
    tmp,
    ['planning', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(validPlan({ reqVersion, designVersion: desVersion, semantic: planSemantic }))
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['planning', '--dir', changeDir, '--finalize']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['review', '--target', 'plan', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(
    tmp,
    ['implementation', '--dir', changeDir, '--task-id', 'TASK-001', '--status', 'done', '--note', 'Implemented and verified with automated tests.', '--files', 'create:src/devices.js']
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['review', '--target', 'implementation', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['knowledge-extraction', '--dir', changeDir]);
  assert.ok(out.data.entries.length >= 1, JSON.stringify(out));

  out = run(
    tmp,
    ['knowledge-extraction', '--dir', changeDir, '--mark-extracted', '--target-doc', 'docs/current/overview.md', '--note', 'Synchronized overview with the implemented change.']
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['knowledge-extraction', '--dir', changeDir, '--complete']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const fReq = readYaml(path.join(changeRoot, 'requirements.yaml'));
  const fDes = readYaml(path.join(changeRoot, 'design.yaml'));
  const fPlan = readYaml(path.join(changeRoot, 'plan.yaml'));
  const dd = readYaml(path.join(changeRoot, 'docs-delta.yaml'));

  assert.equal(fReq.metadata.status, 'accepted');
  assert.equal(fDes.metadata.status, 'accepted');
  assert.equal(fPlan.metadata.status, 'accepted');
  assert.equal(fPlan.metadata.implementation_status, 'accepted');
  assert.equal(dd.metadata.status, 'complete');
});
