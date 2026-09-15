import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { checks } from '../../src/index.ts';
import { makeTempDir } from '../helpers.ts';

const run = checks['ref-covers'].run;

const PARAMS = {
  from: { array: 'components', field: 'satisfies' },
  to: { arrays: ['requirements'], field: 'id' },
};

test('accepts full coverage with the inline target document', () => {
  assert.deepEqual(
    run({
      artifact: { components: [{ id: 'C1', satisfies: ['REQ-1', 'REQ-2'] }] },
      artifacts: { target: { requirements: [{ id: 'REQ-1' }, { id: 'REQ-2' }] } },
      params: PARAMS,
    }),
    []
  );
});

test('reports every uncovered target id once', () => {
  const findings = run({
    artifact: { components: [{ id: 'C1', satisfies: ['REQ-1'] }] },
    artifacts: { target: { requirements: [{ id: 'REQ-1' }, { id: 'REQ-2' }, { id: 'REQ-3' }] } },
    params: PARAMS,
  });

  assert.equal(findings.length, 2);
  const messages = findings.map((f) => f.finding).sort();
  assert.ok(messages[0].includes("'REQ-2' in 'requirements' is not covered by any components.satisfies entry"));
  assert.ok(messages[1].includes("'REQ-3' in 'requirements' is not covered"));
  assert.equal(findings[0].category, 'traceability');
  assert.ok(findings[0].fix!.includes("'REQ-2'"));
});

test('names the target file in the finding target when reading from disk', () => {
  const dir = makeTempDir('checks-ref-covers-');
  fs.writeFileSync(
    path.join(dir, 'target.json'),
    JSON.stringify({ requirements: [{ id: 'REQ-2' }] })
  );

  const findings = run({
    artifact: { components: [{ id: 'C1', satisfies: ['REQ-1'] }] },
    basePath: dir,
    params: { ...PARAMS, to: { ...PARAMS.to, file: 'target.json' } },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'target.json:requirements.id');
});

test('an inline target document works without to.file', () => {
  const findings = run({
    artifact: { components: [{ id: 'C1', satisfies: ['REQ-1'] }] },
    artifacts: { target: { requirements: [{ id: 'REQ-1' }, { id: 'REQ-2' }] } },
    params: PARAMS,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, 'this artifact:requirements.id');
});

test('an unreadable target file no-ops instead of failing', () => {
  const dir = makeTempDir('checks-ref-covers-');

  assert.deepEqual(
    run({
      artifact: { components: [{ id: 'C1', satisfies: [] }] },
      basePath: dir,
      params: { ...PARAMS, to: { ...PARAMS.to, file: 'missing.json' } },
    }),
    []
  );
});

test('coverage unions references across entries and treats scalars as one value', () => {
  assert.deepEqual(
    run({
      artifact: {
        components: [{ id: 'C1', satisfies: 'REQ-1' }, { id: 'C2', satisfies: ['REQ-2'] }],
      },
      artifacts: { target: { requirements: [{ id: 'REQ-1' }, { id: 'REQ-2' }] } },
      params: PARAMS,
    }),
    []
  );
});

test('to.arrays accepts path specs on the target document', () => {
  assert.deepEqual(
    run({
      artifact: { components: [{ id: 'C1', satisfies: ['REQ-1'] }] },
      artifacts: { target: { groups: [{ requirements: [{ id: 'REQ-1' }] }] } },
      params: { ...PARAMS, to: { ...PARAMS.to, arrays: ['groups[].requirements'] } },
    }),
    []
  );
});

test('missing required parameters abort the run', () => {
  assert.throws(
    () => run({ artifact: {} }),
    (err: Error) => err.message.includes('required parameter(s): from, to')
  );
});
