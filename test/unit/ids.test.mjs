import test from 'node:test';
import assert from 'node:assert/strict';

import { nextId, slugify, today, nextIdsFromArrays } from '../../src/scripts/lib/ids.mjs';

test('nextId increments from existing ids', () => {
  assert.equal(nextId(['DL-001', 'DL-002'], 'DL'), 'DL-003');
});

test('nextId starts at 001 when no ids exist', () => {
  assert.equal(nextId([], 'FR'), 'FR-001');
});

test('slugify creates safe slugs', () => {
  assert.equal(slugify('Add Device Registration'), 'add-device-registration');
  assert.equal(slugify('  Weird / Text !! '), 'weird-text');
});

test('today returns ISO date', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test('nextIdsFromArrays computes next ids', () => {
  const artifact = {
    functional_requirements: [{ id: 'FR-001' }, { id: 'FR-002' }],
    acceptance_criteria: [{ id: 'AC-007' }],
  };

  const ids = nextIdsFromArrays(artifact, {
    FR: 'functional_requirements',
    AC: 'acceptance_criteria',
    NFR: 'non_functional_requirements',
  });

  assert.equal(ids.FR, 'FR-003');
  assert.equal(ids.AC, 'AC-008');
  assert.equal(ids.NFR, 'NFR-001');
});
