import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateWithSchema } from '../../src/scripts/lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.mjs');

const commands = [
  ['--help'],
  ['--version'],
  ['--list-workflows'],
  ['requirements', '--help'],
  ['design', '--help'],
  ['planning', '--help'],
  ['implementation', '--help'],
  ['review', '--help'],
  ['knowledge-extraction', '--help'],
  ['status'],
  ['doctor'],
];

for (const args of commands) {
  test(`CLI envelope is valid for: sdlc ${args.join(' ')}`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-env-'));
    const res = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      cwd: tmp,
    });
    assert.ok(res.stdout, `no stdout for: ${args.join(' ')}\n${res.stderr}`);
    const json = JSON.parse(res.stdout);
    const findings = validateWithSchema(json, 'cli-envelope.schema.yaml', root);
    assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
  });
}
