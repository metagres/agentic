import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { nextId, slugify, today, nextIdsFromArrays } from '../../src/scripts/lib/ids.ts';
import { readYaml } from '../../src/scripts/lib/yaml-io.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

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

test('nextIdsFromArrays string specs keep byte-identical behavior', () => {
  const artifact = {
    functional_requirements: [{ id: 'FR-001' }, { id: 'FR-002' }],
    acceptance_criteria: [{ id: 'AC-007' }],
    non_functional_requirements: [],
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

test('nextIdsFromArrays list specs union path-resolved ids before nextId', () => {
  const artifact = {
    functional_requirements: [
      {
        id: 'FR-001',
        acceptance_criteria: [{ id: 'AC-001' }, { id: 'AC-003' }],
      },
      {
        id: 'FR-002',
        acceptance_criteria: [{ id: 'AC-002' }],
      },
    ],
    non_functional_requirements: [
      {
        id: 'NFR-001',
        acceptance_criteria: [{ id: 'AC-005' }],
      },
    ],
  };

  const ids = nextIdsFromArrays(artifact, {
    AC: [
      'functional_requirements[].acceptance_criteria',
      'non_functional_requirements[].acceptance_criteria',
    ],
  });

  assert.equal(ids.AC, 'AC-006');
});

test('nextIdsFromArrays list specs start at 001 when nested collections are empty or absent', () => {
  const artifact = {
    functional_requirements: [
      { id: 'FR-001', acceptance_criteria: [] },
      { id: 'FR-002' },
    ],
  };

  const ids = nextIdsFromArrays(artifact, {
    AC: ['functional_requirements[].acceptance_criteria'],
  });

  assert.equal(ids.AC, 'AC-001');
});

test('a fresh scaffold artifact allocates AC-002 past the seeded example criterion (AC-020)', () => {
  // The parsed template is what init writes (instantiateArtifact deep-clones
  // the parsed template); its scaffold criterion AC-001 participates in the
  // union, so allocation continues at AC-002.
  const scaffold = readYaml(
    path.join(root, 'src', 'stages', 'requirements', 'template.yaml')
  ) as Record<string, unknown>;

  const ids = nextIdsFromArrays(scaffold, {
    FR: 'functional_requirements',
    NFR: 'non_functional_requirements',
    AC: [
      'functional_requirements[].acceptance_criteria',
      'non_functional_requirements[].acceptance_criteria',
    ],
    DL: 'discovery_log',
  });

  assert.equal(ids.AC, 'AC-002');
  assert.equal(ids.FR, 'FR-002');
  assert.equal(ids.NFR, 'NFR-001');
  assert.equal(ids.DL, 'DL-001');
});
