import test from 'node:test';
import assert from 'node:assert/strict';

import { runLintChecks } from '../../src/scripts/lib/lint-checks.ts';
import { checkCrossFileReferences } from '../../src/scripts/lib/validators.ts';

function baseRequirements(overrides: Record<string, unknown> = {}) {
  return {
    problem_statement:
      'Operators cannot register devices, so onboarding requires manual database edits.',
    functional_requirements: [
      {
        id: 'FR-001',
        description:
          'The system shall create a device record when a registration payload contains a unique external identifier.',
        ac_ids: ['AC-001'],
      },
    ],
    non_functional_requirements: [
      {
        id: 'NFR-001',
        description:
          'The registration endpoint shall respond within 500 ms for 95 percent of requests.',
        ac_ids: ['AC-002'],
      },
    ],
    acceptance_criteria: [
      {
        id: 'AC-001',
        statement:
          'Given no device exists, When the client submits a registration, Then the system returns 201 and a device identifier.',
      },
      {
        id: 'AC-002',
        statement:
          'Given load conditions, When 95 percent of requests are measured, Then response time is below 500 ms.',
      },
    ],
    discovery_log: [{ id: 'DL-001', question: 'Q', answer: 'A', lens: 'scope', resolved: true }],
    ...overrides,
  };
}

test('Given/When/Then: a valid AC passes', () => {
  const findings = runLintChecks('requirements', baseRequirements());
  const gwt = findings.filter((f) => f.check === 'given-when-then');
  assert.equal(gwt.length, 0);
});

test('Given/When/Then: an AC missing "then" fails', () => {
  const artifact = baseRequirements({
    acceptance_criteria: [
      {
        id: 'AC-001',
        statement:
          'Given no device exists, When the client submits a registration, the system returns 201.',
      },
    ],
  });
  const findings = runLintChecks('requirements', artifact);
  const gwt = findings.filter((f) => f.check === 'given-when-then');
  assert.equal(gwt.length, 1);
  assert.equal(gwt[0].severity, 'blocking');
  assert.equal(gwt[0].category, 'ambiguity');
  assert.match(gwt[0].finding, /then/i);
});

test('Forbidden words: "fast" in problem_statement is blocking', () => {
  const artifact = baseRequirements({
    problem_statement: 'The system must be fast for all users.',
  });
  const findings = runLintChecks('requirements', artifact);
  const fw = findings.filter((f) => f.check === 'forbidden-word');
  assert.equal(fw.length, 1);
  assert.equal(fw[0].severity, 'blocking');
  assert.match(fw[0].finding, /fast/);
});

test('Forbidden words: "should" is minor', () => {
  const artifact = baseRequirements({
    problem_statement: 'The system should handle registrations.',
  });
  const findings = runLintChecks('requirements', artifact);
  const fw = findings.filter((f) => f.check === 'forbidden-word');
  assert.equal(fw.length, 1);
  assert.equal(fw[0].severity, 'minor');
  assert.match(fw[0].finding, /should/);
});

test('Sentence count: a 7-sentence problem_statement is minor for requirements', () => {
  const sentences = Array.from({ length: 7 }, (_, i) => `Sentence number ${i + 1}.`).join(' ');
  const artifact = baseRequirements({ problem_statement: sentences });
  const findings = runLintChecks('requirements', artifact);
  const sc = findings.filter((f) => f.check === 'sentence-count');
  assert.equal(sc.length, 1);
  assert.equal(sc[0].severity, 'minor');
  assert.equal(sc[0].category, 'completeness');
  assert.match(sc[0].finding, /7 sentence/);
});

test('Orphan AC: an AC not referenced by any FR/NFR produces a minor finding', () => {
  const artifact = baseRequirements({
    acceptance_criteria: [
      ...baseRequirements().acceptance_criteria,
      {
        id: 'AC-099',
        statement:
          'Given a device exists, When the client submits a registration, Then the system returns 409.',
      },
    ],
  });
  const findings = checkCrossFileReferences('requirements', artifact, '/tmp/change');
  const orphan = findings.filter((f) => f.finding.includes('AC-099'));
  assert.equal(orphan.length, 1);
  assert.equal(orphan[0].severity, 'minor');
  assert.equal(orphan[0].category, 'traceability');
});

test('Duplicate ids: two FRs with the same id produce a blocking finding', () => {
  const artifact = baseRequirements({
    functional_requirements: [
      {
        id: 'FR-001',
        description:
          'The system shall create a device record when a registration payload contains a unique external identifier.',
        ac_ids: ['AC-001'],
      },
      {
        id: 'FR-001',
        description:
          'The system shall delete a device record when a deletion payload is received.',
        ac_ids: [],
      },
    ],
  });
  const findings = checkCrossFileReferences('requirements', artifact, '/tmp/change');
  const dup = findings.filter((f) => f.finding.includes("Duplicate ID 'FR-001'"));
  assert.equal(dup.length, 1);
  assert.equal(dup[0].severity, 'blocking');
  assert.equal(dup[0].category, 'structural');
});

test('Execution note required: a done task without implementation_note is blocking', () => {
  const artifact = {
    metadata: { id: 'PLAN-001', stage: 'implementation' },
    tasks: [
      {
        id: 'TASK-001',
        title: 'Implement device registration',
        status: 'done',
        depends_on: [],
      },
    ],
  };
  const findings = checkCrossFileReferences('implementation', artifact, '/tmp/change');
  const note = findings.filter((f) => f.finding.includes('TASK-001'));
  assert.equal(note.length, 1);
  assert.equal(note[0].severity, 'blocking');
  assert.equal(note[0].category, 'completeness');
});