import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { parseJson, readJson, tryReadJson } from '../src/json-io.ts';
import { makeTempDir } from './helpers.ts';

test('readJson parses a JSON object file', () => {
  const dir = makeTempDir('checks-json-io-');
  const file = path.join(dir, 'doc.json');
  fs.writeFileSync(file, JSON.stringify({ items: [{ id: 'A' }] }));

  assert.deepEqual(readJson(file), { items: [{ id: 'A' }] });
});

test('readJson throws a descriptive error for invalid JSON', () => {
  const dir = makeTempDir('checks-json-io-');
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{ not json');

  assert.throws(() => readJson(file), (err: Error) => /Invalid JSON in .*broken\.json/.test(err.message));
});

test('readJson throws a descriptive error for an unreadable file', () => {
  assert.throws(
    () => readJson(path.join(makeTempDir('checks-json-io-'), 'missing.json')),
    (err: Error) => /Unable to read file .*missing\.json/.test(err.message)
  );
});

test('tryReadJson returns null for missing or invalid files, never throws', () => {
  const dir = makeTempDir('checks-json-io-');
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');

  assert.equal(tryReadJson(path.join(dir, 'missing.json')), null);
  assert.equal(tryReadJson(path.join(dir, 'broken.json')), null);

  fs.writeFileSync(path.join(dir, 'ok.json'), '{"a":1}');
  assert.deepEqual(tryReadJson(path.join(dir, 'ok.json')), { a: 1 });
});

test('parseJson parses inline text and names the origin on failure', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.throws(
    () => parseJson('{ nope', '--params'),
    (err: Error) => err.message.includes('Invalid JSON from --params')
  );
});
