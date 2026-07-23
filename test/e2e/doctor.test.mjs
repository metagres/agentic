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

test('doctor warns when docs index missing and strict blocks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-doctor-'));

  const normal = run(['doctor', '--cwd', tmp], tmp);
  assert.equal(normal.state, 'ok');
  assert.ok(normal.warnings.some((w) => w.code === 'DOCS_INDEX_MISSING'));

  const strict = run(['doctor', '--cwd', tmp, '--strict'], tmp);
  assert.equal(strict.state, 'blocked');
  assert.ok(strict.errors.some((e) => e.code === 'DOCS_INDEX_MISSING'));
});
