import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import {
  validRequirements,
  validDesign,
  validPlan,
} from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

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
    JSON.stringify(validRequirements({}))
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['requirements', '--dir', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['requirements-review', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const req = readYaml(path.join(changeRoot, 'requirements.yaml'));
  const reqVersion = req.metadata.version;

  out = run(
    tmp,
    ['design', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(validDesign({ reqVersion }))
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['design', '--dir', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['design-review', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const des = readYaml(path.join(changeRoot, 'design.yaml'));
  const desVersion = des.metadata.version;

  out = run(
    tmp,
    ['planning', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(validPlan({ reqVersion, designVersion: desVersion }))
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['planning', '--dir', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['planning-review', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(
    tmp,
    ['implementation', '--dir', changeDir, '--task-id', 'TASK-001', '--status', 'done', '--note', 'Implemented and verified with automated tests.', '--files', 'create:src/devices.ts']
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['implementation-review', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['knowledge-extraction', '--dir', changeDir]);
  assert.ok(out.data.deltas_to_apply.length >= 1, JSON.stringify(out));

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