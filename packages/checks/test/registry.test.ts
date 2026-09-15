import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks, checkHelp, listChecks, runCheck } from '../src/index.ts';

const SUPPORTED = [
  'unique-ids',
  'ref-exists',
  'ref-covers',
  'duplicate-refs',
  'given-when-then',
  'forbidden-words',
  'required-note-for-status',
  'all-tasks-terminal',
  'dependency-acyclic',
  'dependency-order',
];

test('registry exposes exactly the supported checks, keyed by manifest name', () => {
  assert.deepEqual(Object.keys(checks).sort(), [...SUPPORTED].sort());
  for (const [name, entry] of Object.entries(checks)) {
    assert.equal(entry.manifest.name, name);
  }
});

test('every manifest is fully documented', () => {
  for (const manifest of listChecks()) {
    assert.ok(manifest.description.length > 0, `${manifest.name} needs a description`);
    assert.ok(manifest.params.length > 0, `${manifest.name} needs parameter docs`);
    const names = manifest.params.map((p) => p.name);
    assert.equal(new Set(names).size, names.length, `${manifest.name} has duplicate param names`);
    for (const param of manifest.params) {
      assert.ok(param.name.length > 0, `${manifest.name} param needs a name`);
      assert.ok(param.type.length > 0, `${manifest.name}.${param.name} needs a type`);
      assert.ok(param.description.length > 0, `${manifest.name}.${param.name} needs a description`);
      assert.equal(typeof param.required, 'boolean');
    }
  }
});

test('listChecks returns one manifest per check', () => {
  const manifests = listChecks();
  assert.equal(manifests.length, SUPPORTED.length);
  for (const manifest of manifests) {
    assert.ok(SUPPORTED.includes(manifest.name));
  }
});

test('runCheck rejects unknown check names with the supported list', () => {
  assert.throws(
    () => runCheck('nope', { artifact: {} }),
    (err: Error) => err.message.includes("Unknown check 'nope'") && SUPPORTED.every((n) => err.message.includes(n))
  );
  assert.throws(
    () => checkHelp('nope'),
    (err: Error) => err.message.includes('Supported checks')
  );
});

test('run validates required parameters against the manifest', () => {
  assert.throws(
    () => runCheck('unique-ids', { artifact: {} }),
    (err: Error) => err.message.includes("Check 'unique-ids' is missing required parameter(s): arrays")
  );
  assert.throws(
    () => runCheck('ref-exists', { artifact: {}, params: {} }),
    (err: Error) => err.message.includes('required parameter(s): from, to')
  );
});

test('run requires the artifact to be a JSON object', () => {
  for (const bad of [undefined, null, 'x', 42, []]) {
    assert.throws(
      () => runCheck('unique-ids', { artifact: bad as never, params: { arrays: [] } }),
      (err: Error) => err.message.includes('options.artifact to be a JSON object')
    );
  }
});

test('run validates optional option types when provided', () => {
  const artifact = { items: [] };
  assert.throws(
    () => runCheck('unique-ids', { artifact, params: 'x' as never }),
    (err: Error) => err.message.includes('options.params to be a JSON object')
  );
  assert.throws(
    () => runCheck('unique-ids', { artifact, artifacts: [] as never }),
    (err: Error) => err.message.includes('options.artifacts to be an object')
  );
  assert.throws(
    () => runCheck('unique-ids', { artifact, artifacts: { target: 7 } as never }),
    (err: Error) => err.message.includes('options.artifacts.target to be a JSON object')
  );
  assert.throws(
    () => runCheck('unique-ids', { artifact, basePath: '' }),
    (err: Error) => err.message.includes('options.basePath to be a non-empty string')
  );
});

test('run defaults params to an empty object and succeeds on a clean artifact', () => {
  const findings = runCheck('unique-ids', {
    artifact: { items: [{ id: 'A' }, { id: 'B' }] },
    params: { arrays: ['items'] },
  });
  assert.deepEqual(findings, []);
});

test('help() returns non-empty parameter documentation for every check', () => {
  for (const [name, entry] of Object.entries(checks)) {
    const text = entry.help();
    assert.ok(text.includes('Parameters:'), `${name} help must list parameters`);
    for (const param of entry.manifest.params) {
      assert.ok(text.includes(param.name), `${name} help must mention ${param.name}`);
    }
  }
});
