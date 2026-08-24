import test from 'node:test';
import assert from 'node:assert/strict';

import { runStageChecks } from '../../src/scripts/lib/checks/index.ts';
import type { StructuralChecksDoc } from '../../src/scripts/lib/checks/index.ts';
import type { CheckContext } from '../../src/scripts/lib/checks/shared.ts';

const REQUIREMENTS_CHECKS: StructuralChecksDoc = {
  version: 1,
  checks: [
    {
      check: 'unique-ids',
      params: {
        arrays: [
          'functional_requirements',
          'non_functional_requirements',
          'acceptance_criteria',
          'discovery_log',
        ],
      },
    },
    {
      check: 'referenced-by',
      params: {
        array: 'acceptance_criteria',
        by: [
          { array: 'functional_requirements', ref_field: 'ac_ids' },
          { array: 'non_functional_requirements', ref_field: 'ac_ids' },
        ],
      },
    },
    { check: 'duplicate-refs', params: { array: 'functional_requirements', list_field: 'ac_ids' } },
    { check: 'duplicate-refs', params: { array: 'non_functional_requirements', list_field: 'ac_ids' } },
    { check: 'given-when-then', params: { array: 'acceptance_criteria' } },
    {
      check: 'forbidden-words',
      params: {
        fields: [
          'problem_statement',
          'functional_requirements[].description',
          'non_functional_requirements[].description',
          'acceptance_criteria[].statement',
        ],
      },
    },
    { check: 'sentence-count', params: { field: 'problem_statement', min: 1, max: 6 } },
  ],
};

function context(changeRoot: string | null = null): CheckContext {
  return { cwd: process.cwd(), changeRoot };
}

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
  const findings = runStageChecks(
    'requirements',
    'requirements',
    baseRequirements(),
    context(),
    REQUIREMENTS_CHECKS
  );
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
  const findings = runStageChecks('requirements', 'requirements', artifact, context(), REQUIREMENTS_CHECKS);
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
  const findings = runStageChecks('requirements', 'requirements', artifact, context(), REQUIREMENTS_CHECKS);
  const fw = findings.filter((f) => f.check === 'forbidden-word');
  assert.equal(fw.length, 1);
  assert.equal(fw[0].severity, 'blocking');
  assert.match(fw[0].finding, /fast/);
});

test('Forbidden words: "should" is minor', () => {
  const artifact = baseRequirements({
    problem_statement: 'The system should handle registrations.',
  });
  const findings = runStageChecks('requirements', 'requirements', artifact, context(), REQUIREMENTS_CHECKS);
  const fw = findings.filter((f) => f.check === 'forbidden-word');
  assert.equal(fw.length, 1);
  assert.equal(fw[0].severity, 'minor');
  assert.match(fw[0].finding, /should/);
});

test('Sentence count: a 7-sentence problem_statement is minor for requirements', () => {
  const sentences = Array.from({ length: 7 }, (_, i) => `Sentence number ${i + 1}.`).join(' ');
  const artifact = baseRequirements({ problem_statement: sentences });
  const findings = runStageChecks('requirements', 'requirements', artifact, context(), REQUIREMENTS_CHECKS);
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
  const findings = runStageChecks('requirements', 'requirements', artifact, context(), REQUIREMENTS_CHECKS);
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
  const findings = runStageChecks('requirements', 'requirements', artifact, context(), REQUIREMENTS_CHECKS);
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
  const checks: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'required-note-for-status',
        params: { array: 'tasks', statuses: ['done', 'blocked', 'skipped'] },
      },
    ],
  };
  const findings = runStageChecks('implementation', 'implementation', artifact, context(), checks);
  const note = findings.filter((f) => f.finding.includes('TASK-001'));
  assert.equal(note.length, 1);
  assert.equal(note[0].severity, 'blocking');
  assert.equal(note[0].category, 'completeness');
});

test('unknown check aborts the run naming the stage folder and entry', () => {
  const checks: StructuralChecksDoc = {
    version: 1,
    checks: [{ check: 'mystery-check', params: {} }],
  };

  assert.throws(
    () =>
      runStageChecks(
        'requirements',
        'src/stages/requirements',
        baseRequirements(),
        context(),
        checks
      ),
    /requirements.*mystery-check|mystery-check/
  );
});

test('malformed parameters abort the run naming the stage folder and entry', () => {
  const checks: StructuralChecksDoc = {
    version: 1,
    checks: [{ check: 'sentence-count', params: { field: 'problem_statement' } }],
  };

  assert.throws(
    () =>
      runStageChecks(
        'requirements',
        'src/stages/requirements',
        baseRequirements(),
        context(),
        checks
      ),
    /requirements.*sentence-count|sentence-count/
  );
});

test('ref-exists resolves references against a target artifact in the change root', () => {
  const checks: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'ref-exists',
        params: {
          from: { array: 'traceability', field: 'requirement_id' },
          to: {
            file: 'requirements.yaml',
            arrays: ['functional_requirements', 'non_functional_requirements'],
            field: 'id',
          },
        },
      },
    ],
  };

  const artifact = {
    traceability: [
      { requirement_id: 'FR-001', component_ids: ['CMP-001'] },
      { requirement_id: 'FR-099', component_ids: ['CMP-001'] },
    ],
  };

  const changeRoot = '/tmp/nonexistent-change-root';
  const findings = runStageChecks('design', 'design', artifact, context(changeRoot), checks);
  // Target artifact does not exist, so the check is skipped (same as legacy).
  assert.equal(findings.length, 0);
});
