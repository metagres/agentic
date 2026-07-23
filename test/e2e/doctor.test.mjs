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
    cwd,
    timeout: 30000,
  });
  const detail = [
    `exit=${res.status}`,
    `signal=${res.signal}`,
    `stderr: ${res.stderr || '(empty)'}`,
    `stdout: ${(res.stdout || '').slice(0, 500) || '(empty)'}`,
  ].join('\n');
  assert.ok(res.stdout && res.stdout.trim(), `CLI produced no stdout.\n${detail}`);
  let json;
  try {
    json = JSON.parse(res.stdout);
  } catch (e) {
    assert.fail(`CLI stdout is not valid JSON.\n${detail}\nParse error: ${e.message}`);
  }
  return json;
}

test('doctor warns when docs index missing and strict blocks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-doctor-'));

  const normal = run(['doctor', '--cwd', tmp], tmp);
  assert.equal(normal.state, 'ok', JSON.stringify(normal, null, 2));
  assert.ok(
    normal.warnings.some((w) => w.code === 'DOCS_INDEX_MISSING'),
    `Expected DOCS_INDEX_MISSING warning. Got: ${JSON.stringify(normal.warnings)}`
  );

  const strict = run(['doctor', '--cwd', tmp, '--strict'], tmp);
  assert.equal(strict.state, 'blocked', JSON.stringify(strict, null, 2));
  assert.ok(
    strict.errors.some((e) => e.code === 'DOCS_INDEX_MISSING'),
    `Expected DOCS_INDEX_MISSING error in strict mode. Got: ${JSON.stringify(strict.errors)}`
  );
});