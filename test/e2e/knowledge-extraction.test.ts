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
  // No docs/current: the knowledge-init skill is the sole creator, so the
  // stage must warn (DOCS_INDEX_MISSING) without creating the directory.
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-kx-'));
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

test('knowledge extraction lists deltas and completes', () => {
  const tmp = makeTmpProject();
  let out = run(tmp, ['requirements', '--request', 'Add architecture note']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  const withDelta = validRequirements({
    request: 'Add architecture note',
    delta: [
      {
        phase: 'Requirements',
        target_doc: 'docs/current/architecture.md',
        change: 'Add',
        reason: 'Add device registration architecture section.',
        date: '2026-07-23',
      },
    ],
  });
  out = run(tmp, ['requirements', '--change', changeDir, '--update-artifact'], JSON.stringify(withDelta));
  assert.notEqual(out.state, 'blocked');

  // We need to mock implementation acceptance to complete KX
  // For this test, we'll just manually write a plan.yaml with accepted status
  fs.writeFileSync(path.join(changeRoot, 'plan.yaml'), 'metadata:\n  implementation_status: accepted\n', 'utf8');

  out = run(tmp, ['knowledge-extraction', '--change', changeDir]);
  assert.equal(out.data.deltas_to_apply.length, 1);
  assert.equal(out.data.deltas_to_apply[0].target_doc, 'docs/current/architecture.md');

  // Without docs/current the stage warns and names the knowledge-init skill.
  const listingWarning = out.warnings.find((w) => w.code === 'DOCS_INDEX_MISSING');
  assert.ok(
    listingWarning,
    `Expected DOCS_INDEX_MISSING warning. Got: ${JSON.stringify(out.warnings)}`
  );
  assert.match(listingWarning.fix, /knowledge-init/);
  assert.ok(
    !fs.existsSync(path.join(tmp, 'docs', 'current')),
    'the stage must not create docs/current'
  );

  out = run(tmp, ['knowledge-extraction', '--change', changeDir, '--complete']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const completeWarning = out.warnings.find((w) => w.code === 'DOCS_INDEX_MISSING');
  assert.ok(
    completeWarning,
    `Expected DOCS_INDEX_MISSING warning on --complete. Got: ${JSON.stringify(out.warnings)}`
  );
  assert.ok(
    !fs.existsSync(path.join(tmp, 'docs', 'current')),
    'the stage must not create docs/current'
  );

  const dd = readYaml(path.join(changeRoot, 'docs-delta.yaml'));
  assert.equal(dd.metadata.status, 'complete');
  assert.equal(dd.deltas_applied, 1);
});