import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '../../src/scripts/sdlc.mjs');

function run(args, cwd) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd
  });
  assert.ok(res.stdout, res.stderr);
  return JSON.parse(res.stdout);
}

test('strict mode blocks selected warnings', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-strict-'));

  const req = run(['requirements', '--cwd', tmp, '--request', 'Add login'], tmp);
  const changeDir = path.basename(req.data.change_root);

  const planning = run(['planning', '--cwd', tmp, '--dir', changeDir, '--strict'], tmp);
  assert.equal(planning.state, 'blocked');
  assert.ok(planning.errors.some((e) => e.code === 'REQUIREMENTS_NOT_READY'));

  const knowledge = run(
    ['knowledge-extraction', '--cwd', tmp, '--dir', changeDir, '--strict'],
    tmp
  );
  assert.equal(knowledge.state, 'blocked');
  assert.ok(knowledge.errors.some((e) => e.code === 'DOCS_INDEX_MISSING'));
});
