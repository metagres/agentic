import test from 'node:test';
import assert from 'node:assert/strict';

import { getStepDefinitions } from '../../src/scripts/lib/steps-loader.ts';

test('getStepDefinitions is loader-backed over the discovered authoring stages', () => {
  const authoringWorkflows = ['requirements', 'design', 'planning'];

  for (const stage of authoringWorkflows) {
    const defs = getStepDefinitions(stage);
    assert.ok(defs, `no stepDefinitions for stage '${stage}'`);
    assert.ok(Object.keys(defs).length > 0, `empty stepDefinitions for '${stage}'`);
  }
});

test('getStepDefinitions returns definitions for every discovered stage kind', () => {
  // Review stages, the tasks stage, and the aggregator stage all carry
  // steps.yaml and must be resolvable through the loader.
  for (const stage of [
    'requirements-review',
    'design-review',
    'planning-review',
    'implementation',
    'implementation-review',
    'knowledge-extraction',
  ]) {
    const defs = getStepDefinitions(stage);
    assert.ok(defs, `no stepDefinitions for stage '${stage}'`);
    assert.ok(Object.keys(defs).length > 0, `empty stepDefinitions for '${stage}'`);
  }
});

test('getStepDefinitions returns null for unknown stage', () => {
  assert.equal(getStepDefinitions('does-not-exist'), null);
});
