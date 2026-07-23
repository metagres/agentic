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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-kx-'));
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

test('knowledge extraction archives removed delta entries and completes', () => {
  const tmp = makeTmpProject();
  let out = run(tmp, ['requirements', '--request', 'Add overview']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  const withDelta = validRequirements({
    request: 'Add overview',
    semantic: semanticResults(root, 'requirements'),
    delta: [
      {
        phase: 'Requirements',
        target_doc: 'docs/current/overview.md',
        change: 'Add',
        reason: 'Add device registration overview section.',
        date: '2026-07-23',
      },
    ],
  });
  out = run(tmp, ['requirements', '--dir', changeDir, '--update-artifact'], JSON.stringify(withDelta));
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['knowledge-extraction', '--dir', changeDir]);
  assert.equal(out.data.entries.length, 1);
  assert.equal(out.data.entries[0].status, 'pending');

  out = run(
    tmp,
    ['knowledge-extraction', '--dir', changeDir, '--mark-extracted', '--target-doc', 'docs/current/overview.md', '--note', 'Updated overview section with registration details.']
  );
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['knowledge-extraction', '--dir', changeDir]);
  assert.equal(out.data.entries.length, 1);
  assert.equal(out.data.entries[0].status, 'extracted');

  const noDelta = validRequirements({
    request: 'Add overview',
    semantic: semanticResults(root, 'requirements'),
    delta: [],
  });
  out = run(tmp, ['requirements', '--dir', changeDir, '--update-artifact'], JSON.stringify(noDelta));
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['knowledge-extraction', '--dir', changeDir]);
  assert.equal(out.data.entries.length, 0);

  let dd = readYaml(path.join(changeRoot, 'docs-delta.yaml'));
  assert.equal(dd.archived_entries.length, 1);
  assert.equal(dd.archived_entries[0].archived_reason, 'removed_from_source_artifact');

  out = run(tmp, ['knowledge-extraction', '--dir', changeDir, '--complete']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  dd = readYaml(path.join(changeRoot, 'docs-delta.yaml'));
  assert.equal(dd.metadata.status, 'complete');
});
