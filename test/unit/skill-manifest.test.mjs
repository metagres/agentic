import test from 'node:test';
import assert from 'node:assert/strict';

import { skillDefinitions } from '../../src/scripts/workflows/skill-manifest.mjs';

test('skill manifest defines all expected skills', () => {
  const ids = skillDefinitions.map((skill) => skill.id);

  assert.ok(ids.includes('requirements-authoring'));
  assert.ok(ids.includes('design-authoring'));
  assert.ok(ids.includes('planning'));
  assert.ok(ids.includes('implementation'));
  assert.ok(ids.includes('review'));
  assert.ok(ids.includes('knowledge-extraction'));
});

test('every skill has required fields', () => {
  for (const skill of skillDefinitions) {
    assert.ok(skill.id, 'skill.id missing');
    assert.ok(skill.workflow, `skill.workflow missing for ${skill.id}`);
    assert.ok(skill.title, `skill.title missing for ${skill.id}`);
    assert.ok(skill.description, `skill.description missing for ${skill.id}`);
    assert.ok(skill.overview, `skill.overview missing for ${skill.id}`);
    assert.ok(Array.isArray(skill.steps), `skill.steps missing for ${skill.id}`);
    assert.ok(skill.steps.length > 0, `skill.steps empty for ${skill.id}`);
    assert.ok(
      Array.isArray(skill.commands),
      `skill.commands missing for ${skill.id}`
    );
    assert.ok(
      skill.commands.length > 0,
      `skill.commands empty for ${skill.id}`
    );
  }
});
