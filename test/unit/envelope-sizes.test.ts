import test from 'node:test';
import assert from 'node:assert/strict';

// WB: unit tests for the invocation-class classifier extracted from
// envelope_sizes.ts. Pure-function import — no CLI spawn, no repository
// side effects: the module has no import-time behavior.
import {
  STAGES,
  invocationClass,
} from '../../src/skills/improvement-review/scripts/invocation_class.ts';

test('review stages (mandatory --dry-run) classify as detection', () => {
  for (const id of [
    'requirements-review',
    'design-review',
    'planning-review',
    'implementation-review',
  ]) {
    assert.equal(invocationClass(id), 'detection', `stage '${id}' should be detection`);
  }
});

test('authoring stages classify as mutation', () => {
  for (const id of [
    'requirements',
    'design',
    'planning',
    'implementation',
    'knowledge-extraction',
  ]) {
    assert.equal(invocationClass(id), 'mutation', `stage '${id}' should be mutation`);
  }
});

test('every stage in the canonical STAGES matrix carries a known class and a dry-run flag', () => {
  assert.equal(STAGES.length, 9);
  for (const stage of STAGES) {
    assert.equal(typeof stage.dryRun, 'boolean');
    assert.doesNotThrow(() => invocationClass(stage.id));
  }
});

test('the dry-run flag and the classifier agree on every stage (single classification source)', () => {
  for (const stage of STAGES) {
    assert.equal(stage.dryRun, invocationClass(stage.id) === 'detection');
  }
});

test('an unknown stage id throws naming the id instead of classifying', () => {
  assert.throws(() => invocationClass('not-a-stage'), /unknown stage id 'not-a-stage'/);
});
