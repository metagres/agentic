import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { checks } from '../../src/index.ts';
import { makeTempDir } from '../helpers.ts';

const run = checks['ref-exists'].run;

const PARAMS = {
  from: { array: 'tasks', field: 'requires' },
  to: { arrays: ['requirements'], field: 'id' },
};

test('accepts references that all exist in the inline target document', () => {
  assert.deepEqual(
    run({
      artifact: { tasks: [{ id: 'T1', requires: ['REQ-1'] }] },
      artifacts: { target: { requirements: [{ id: 'REQ-1' }, { id: 'REQ-2' }] } },
      params: PARAMS,
    }),
    []
  );
});

test('reports dangling references', () => {
  const findings = run({
    artifact: { tasks: [{ id: 'T1', requires: ['REQ-1', 'REQ-9'] }] },
    artifacts: { target: { requirements: [{ id: 'REQ-1' }] } },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'ref-exists');
  assert.equal(findings[0].category, 'traceability');
  assert.equal(findings[0].target, 'tasks[].requires');
  assert.ok(findings[0].finding.includes('T1 references missing requires value'));
  assert.ok(findings[0].finding.includes("'REQ-9'"));
});

test('entries without an id are still reported, as "an entry"', () => {
  const findings = run({
    artifact: { tasks: [{ requires: ['NOPE'] }] },
    artifacts: { target: { requirements: [] } },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.startsWith('an entry references missing'));
});

test('a scalar string reference is treated as one reference', () => {
  const findings = run({
    artifact: { tasks: [{ id: 'T1', requires: 'REQ-9' }] },
    artifacts: { target: { requirements: [{ id: 'REQ-1' }] } },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes("'REQ-9'"));
});

test('the to.arrays selector accepts path specs on the target document', () => {
  assert.deepEqual(
    run({
      artifact: { tasks: [{ id: 'T1', requires: ['REQ-1'] }] },
      artifacts: { target: { groups: [{ requirements: [{ id: 'REQ-1' }] }] } },
      params: { from: { array: 'tasks', field: 'requires' }, to: { arrays: ['groups[].requirements'], field: 'id' } },
    }),
    []
  );
});

test('reads the target from to.file relative to basePath', () => {
  const dir = makeTempDir('checks-ref-exists-');
  fs.writeFileSync(
    path.join(dir, 'target.json'),
    JSON.stringify({ requirements: [{ id: 'REQ-1' }] })
  );
  const artifact = {
    tasks: [{ id: 'T1', requires: ['REQ-1'] }, { id: 'T2', requires: ['REQ-9'] }],
  };

  const findings = run({
    artifact,
    basePath: dir,
    params: { ...PARAMS, to: { ...PARAMS.to, file: 'target.json' } },
  });

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('in target.json'));
});

test('an unreadable target file no-ops instead of failing', () => {
  const dir = makeTempDir('checks-ref-exists-');

  assert.deepEqual(
    run({
      artifact: { tasks: [{ id: 'T1', requires: ['REQ-9'] }] },
      basePath: dir,
      params: { ...PARAMS, to: { ...PARAMS.to, file: 'missing.json' } },
    }),
    []
  );
});

test('to.file of "." means the artifact itself', () => {
  const artifact = {
    tasks: [{ id: 'T1', requires: ['REQ-1'] }],
    requirements: [{ id: 'REQ-1' }],
  };

  assert.deepEqual(
    run({ artifact, params: { ...PARAMS, to: { ...PARAMS.to, file: '.' } } }),
    []
  );
});

test('inline artifacts.target takes precedence over to.file', () => {
  const dir = makeTempDir('checks-ref-exists-');
  fs.writeFileSync(
    path.join(dir, 'target.json'),
    JSON.stringify({ requirements: [{ id: 'REQ-ONLY-ON-DISK' }] })
  );

  const findings = run({
    artifact: { tasks: [{ id: 'T1', requires: ['REQ-INLINE'] }] },
    artifacts: { target: { requirements: [{ id: 'REQ-INLINE' }] } },
    basePath: dir,
    params: { ...PARAMS, to: { ...PARAMS.to, file: 'target.json' } },
  });

  assert.deepEqual(findings, []);
});

test('missing required parameters abort the run', () => {
  assert.throws(
    () => run({ artifact: {} }),
    (err: Error) => err.message.includes('required parameter(s): from, to')
  );
});
