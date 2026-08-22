import test from 'node:test';
import assert from 'node:assert/strict';

import { skillManifest, getStepDefinitions } from '../../src/scripts/workflows/skill-manifest.ts';

test('skill manifest defines the single agentic-sdlc skill', () => {
  assert.equal(skillManifest.id, 'agentic-sdlc');
  assert.ok(skillManifest.title, 'skillManifest.title missing');
  assert.ok(skillManifest.description, 'skillManifest.description missing');
  assert.match(skillManifest.description, /requirements/);
  assert.match(skillManifest.description, /knowledge-extraction/);
});

test('getStepDefinitions returns definitions for each authoring workflow', () => {
  const authoringWorkflows = ['requirements', 'design', 'planning'];

  for (const workflow of authoringWorkflows) {
    const defs = getStepDefinitions(workflow);
    assert.ok(defs, `no stepDefinitions for workflow '${workflow}'`);
    assert.ok(Object.keys(defs).length > 0, `empty stepDefinitions for '${workflow}'`);
  }
});

test('getStepDefinitions returns null for unknown workflow', () => {
  assert.equal(getStepDefinitions('does-not-exist'), null);
});
