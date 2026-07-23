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

test('docs-init creates index and does not overwrite without force', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-docs-init-'));
  const indexPath = path.join(tmp, 'docs', 'current', 'index.md');

  const first = run(['docs-init', '--cwd', tmp], tmp);
  assert.equal(first.state, 'complete');
  assert.ok(fs.existsSync(indexPath));

  fs.writeFileSync(indexPath, '# custom\n', 'utf8');

  const second = run(['docs-init', '--cwd', tmp], tmp);
  assert.equal(second.state, 'ok');
  assert.ok(second.warnings.some((w) => w.code === 'DOCS_INDEX_EXISTS'));
  assert.equal(fs.readFileSync(indexPath, 'utf8'), '# custom\n');

  const forced = run(['docs-init', '--cwd', tmp, '--force'], tmp);
  assert.equal(forced.state, 'complete');
  assert.ok(fs.readFileSync(indexPath, 'utf8').includes('Current Docs Index'));
});
