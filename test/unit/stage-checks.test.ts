import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runStageChecks, CHECK_CATALOG } from '../../src/scripts/lib/checks/index.ts';
import type { StructuralChecksDoc } from '../../src/scripts/lib/checks/index.ts';
import type { CheckContext } from '../../src/scripts/lib/checks/shared.ts';
import { readYaml } from '../../src/scripts/lib/yaml-io.ts';

const REQUIREMENTS_CHECKS: StructuralChecksDoc = {
  version: 1,
  checks: [
    {
      check: 'unique-ids',
      params: {
        arrays: ['functional_requirements', 'non_functional_requirements', 'discovery_log'],
        unions: [
          {
            arrays: [
              'functional_requirements[].acceptance_criteria',
              'non_functional_requirements[].acceptance_criteria',
            ],
          },
        ],
      },
    },
    {
      check: 'given-when-then',
      params: {
        arrays: [
          'functional_requirements[].acceptance_criteria',
          'non_functional_requirements[].acceptance_criteria',
        ],
      },
    },
    {
      check: 'forbidden-words',
      params: {
        fields: [
          'problem_statement',
          'functional_requirements[].description',
          'non_functional_requirements[].description',
          'functional_requirements[].acceptance_criteria[].statement',
          'non_functional_requirements[].acceptance_criteria[].statement',
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
        acceptance_criteria: [
          {
            id: 'AC-001',
            statement:
              'Given no device exists, When the client submits a registration, Then the system returns 201 and a device identifier.',
            category: 'happy',
          },
        ],
      },
    ],
    non_functional_requirements: [
      {
        id: 'NFR-001',
        description:
          'The registration endpoint shall respond within 500 ms for 95 percent of requests.',
        acceptance_criteria: [
          {
            id: 'AC-002',
            statement:
              'Given load conditions, When 95 percent of requests are measured, Then response time is below 500 ms.',
            category: 'boundary',
          },
        ],
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
  const artifact = baseRequirements();
  (artifact.functional_requirements[0].acceptance_criteria[0] as { statement: string }).statement =
    'Given no device exists, When the client submits a registration, the system returns 201.';
  const findings = runStageChecks('requirements', 'requirements', artifact, context(), REQUIREMENTS_CHECKS);
  const gwt = findings.filter((f) => f.check === 'given-when-then');
  assert.equal(gwt.length, 1);
  assert.equal(gwt[0].severity, 'blocking');
  assert.equal(gwt[0].category, 'ambiguity');
  assert.match(gwt[0].finding, /then/i);
  // The finding targets the full nested statement path (AC-011).
  assert.equal(gwt[0].target, 'functional_requirements[0].acceptance_criteria[0].statement');
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

test('Duplicate ids: two FRs with the same id produce a blocking finding', () => {
  const artifact = baseRequirements({
    functional_requirements: [
      {
        id: 'FR-001',
        description:
          'The system shall create a device record when a registration payload contains a unique external identifier.',
        acceptance_criteria: [
          {
            id: 'AC-001',
            statement:
              'Given no device exists, When the client submits a registration, Then the system returns 201 and a device identifier.',
            category: 'happy',
          },
        ],
      },
      {
        id: 'FR-001',
        description:
          'The system shall delete a device record when a deletion payload is received.',
        acceptance_criteria: [
          {
            id: 'AC-003',
            statement:
              'Given a device exists, When the client submits a deletion, Then the system removes the record.',
            category: 'negative',
          },
        ],
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

// ---------------------------------------------------------------------------
// Byte-identical pinning tests (TASK-001 baseline, DEC-008): the unchanged
// design and planning structural-check declarations must produce identical
// findings before and after the check library routes array selection through
// the artifact path resolver. The declarations are loaded from the live stage
// folders so the pins cover the real declarations, not test copies.
// ---------------------------------------------------------------------------

const PLANNING_CHECKS = readYaml(
  path.join(process.cwd(), 'src', 'stages', 'planning', 'structural-checks.yaml')
) as StructuralChecksDoc;

const DESIGN_CHECKS = readYaml(
  path.join(process.cwd(), 'src', 'stages', 'design', 'structural-checks.yaml')
) as StructuralChecksDoc;

function pinningChangeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-pinning-'));
  fs.writeFileSync(
    path.join(root, 'requirements.yaml'),
    [
      'functional_requirements:',
      '  - id: FR-001',
      '    description: The system shall create a device record.',
      '    acceptance_criteria:',
      '      - id: AC-001',
      '        statement: Given no device exists, When the client submits, Then the system returns 201.',
      '        category: happy',
      'non_functional_requirements:',
      '  - id: NFR-001',
      '    description: The endpoint shall respond within 500 ms.',
      '    acceptance_criteria:',
      '      - id: AC-002',
      '        statement: Given load, When measured, Then response time is below 500 ms.',
      '        category: boundary',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(root, 'design.yaml'),
    [
      'decisions:',
      '  - id: DEC-001',
      '    title: Use external identifier',
      '    context: Devices provide an external identifier.',
      '    decision: Use the external identifier as the unique key.',
      '    status: accepted',
      '',
    ].join('\n')
  );
  return root;
}

function pinningPlan(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { id: 'PLAN-001', stage: 'planning', status: 'draft' },
    tasks: [
      {
        id: 'TASK-001',
        title: 'Implement device registration',
        description: 'Add endpoint and persistence for device registration.',
        type: 'implementation',
        status: 'pending',
        complexity: 'low',
        covers: ['FR-001', 'NFR-001'],
        acceptance_ids: ['AC-001', 'AC-002'],
        design_refs: ['DEC-001'],
        depends_on: [],
        files: [],
      },
    ],
    milestones: [
      {
        id: 'MS-001',
        title: 'Device registration works end to end',
        tasks: ['TASK-001'],
        done_when: 'The registration endpoint creates a device record and returns 201.',
      },
    ],
    risks: [{ id: 'RISK-001', description: 'A risk.', mitigation: 'Mitigated.' }],
    ...overrides,
  };
}

test('pinning: planning declarations pass a valid plan with zero findings', () => {
  const root = pinningChangeRoot();
  try {
    const findings = runStageChecks(
      'planning',
      'src/stages/planning',
      pinningPlan(),
      context(root),
      PLANNING_CHECKS
    );
    assert.deepEqual(findings, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pinning: planning unique-ids duplicate findings are verbatim', () => {
  const artifact = pinningPlan({
    milestones: [
      pinningPlan().milestones[0],
      {
        id: 'MS-001',
        title: 'Duplicate milestone',
        tasks: [],
        done_when: 'Done when verified.',
      },
    ],
    risks: [
      { id: 'RISK-001', description: 'A risk.', mitigation: 'Mitigated.' },
      { id: 'RISK-001', description: 'Duplicate risk.', mitigation: 'Mitigated.' },
    ],
  });
  const findings = runStageChecks(
    'planning',
    'src/stages/planning',
    artifact,
    context(null),
    PLANNING_CHECKS
  );
  const dupFindings = findings.filter((f) => f.check === 'unique-ids');
  assert.equal(dupFindings.length, 2);
  assert.deepEqual(
    dupFindings.map((f) => f.finding),
    ["Duplicate ID 'MS-001' in 'milestones'", "Duplicate ID 'RISK-001' in 'risks'"]
  );
  assert.deepEqual(
    dupFindings.map((f) => f.target),
    ['milestones[].id', 'risks[].id']
  );
});

test('pinning: planning ref-exists findings are verbatim for in-artifact and cross-file targets', () => {
  const root = pinningChangeRoot();
  try {
    const artifact = pinningPlan({
      tasks: [
        {
          id: 'TASK-001',
          title: 'Implement device registration',
          description: 'Add endpoint and persistence for device registration.',
          type: 'implementation',
          status: 'pending',
          complexity: 'low',
          covers: ['FR-999'],
          acceptance_ids: ['AC-999'],
          design_refs: ['DEC-999'],
          depends_on: [],
          files: [],
        },
      ],
      milestones: [
        {
          id: 'MS-001',
          title: 'Device registration works end to end',
          tasks: ['TASK-999'],
          done_when: 'The registration endpoint creates a device record and returns 201.',
        },
      ],
    });
    const findings = runStageChecks(
      'planning',
      'src/stages/planning',
      artifact,
      context(root),
      PLANNING_CHECKS
    );
    const refFindings = findings.filter((f) => f.check === 'ref-exists');
    assert.deepEqual(
      refFindings.map((f) => f.finding),
      [
        "MS-001 references missing tasks value 'TASK-999' in this artifact",
        "TASK-001 references missing covers value 'FR-999' in requirements.yaml",
        "TASK-001 references missing acceptance_ids value 'AC-999' in requirements.yaml",
        "TASK-001 references missing design_refs value 'DEC-999' in design.yaml",
      ]
    );
    assert.deepEqual(
      refFindings.map((f) => f.target),
      [
        'milestones[].tasks',
        'tasks[].covers',
        'tasks[].acceptance_ids',
        'tasks[].design_refs',
      ]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pinning: planning dependency-order finding is verbatim', () => {
  const plan = pinningPlan();
  const tasks = plan.tasks as Record<string, unknown>[];
  tasks.push({ ...tasks[0], id: 'TASK-002', title: 'Second' });
  (tasks[0] as { depends_on: string[] }).depends_on = ['TASK-002'];
  const findings = runStageChecks(
    'planning',
    'src/stages/planning',
    plan,
    context(null),
    PLANNING_CHECKS
  );
  const orderFindings = findings.filter((f) => f.check === 'dependency-order');
  assert.equal(orderFindings.length, 1);
  assert.equal(
    orderFindings[0].finding,
    'Task TASK-001 depends on TASK-002 which appears later in the plan'
  );
});

test('pinning: design declarations pass a valid design with zero findings', () => {
  const root = pinningChangeRoot();
  try {
    const artifact = {
      metadata: { id: 'DES-001', stage: 'design', status: 'draft' },
      context_summary: 'The design adds a registration endpoint backed by a device repository.',
      traceability: [{ requirement_id: 'FR-001', component_ids: ['CMP-001'] }],
    };
    const findings = runStageChecks(
      'design',
      'src/stages/design',
      artifact,
      context(root),
      DESIGN_CHECKS
    );
    assert.deepEqual(findings, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pinning: design ref-exists and duplicate-refs findings are verbatim', () => {
  const root = pinningChangeRoot();
  try {
    const artifact = {
      metadata: { id: 'DES-001', stage: 'design', status: 'draft' },
      context_summary: 'The design adds a registration endpoint backed by a device repository.',
      traceability: [
        { requirement_id: 'FR-999', component_ids: ['CMP-001', 'CMP-001'] },
      ],
    };
    const findings = runStageChecks(
      'design',
      'src/stages/design',
      artifact,
      context(root),
      DESIGN_CHECKS
    );
    assert.deepEqual(
      findings.map((f) => f.finding),
      [
        "an entry references missing requirement_id value 'FR-999' in requirements.yaml",
        "Duplicate CMP reference 'CMP-001' in entry",
      ]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// unique-ids unions groups (DM-003, AC-007): one uniqueness scope across the
// union of path-resolved collections, with the duplicate finding naming the
// id and every containing entry location.
// ---------------------------------------------------------------------------

function nestedCriteriaDoc() {
  return {
    functional_requirements: [
      {
        id: 'FR-001',
        description: 'The system shall create a device record.',
        acceptance_criteria: [
          { id: 'AC-001', statement: 'Given none, When submitted, Then 201.', category: 'happy' },
        ],
      },
      {
        id: 'FR-002',
        description: 'The system shall reject unknown devices.',
        acceptance_criteria: [
          { id: 'AC-002', statement: 'Given unknown, When queried, Then 404.', category: 'edge' },
        ],
      },
    ],
    non_functional_requirements: [
      {
        id: 'NFR-001',
        description: 'The endpoint shall respond within 500 ms.',
        acceptance_criteria: [
          { id: 'AC-003', statement: 'Given load, When measured, Then under 500 ms.', category: 'boundary' },
        ],
      },
    ],
  };
}

const UNIONS_CHECKS: StructuralChecksDoc = {
  version: 1,
  checks: [
    {
      check: 'unique-ids',
      params: {
        arrays: ['functional_requirements', 'non_functional_requirements'],
        unions: [
          {
            arrays: [
              'functional_requirements[].acceptance_criteria',
              'non_functional_requirements[].acceptance_criteria',
            ],
          },
        ],
      },
    },
  ],
};

test('unions group: distinct ids across FR-nested and NFR-nested criteria yield no findings', () => {
  const findings = runStageChecks(
    'requirements',
    'src/stages/requirements',
    nestedCriteriaDoc(),
    context(),
    UNIONS_CHECKS
  );
  assert.deepEqual(findings, []);
});

test('unions group: two FR-nested criteria collections are evaluated as one union (AC-007)', () => {
  const artifact = nestedCriteriaDoc();
  (artifact.functional_requirements[1].acceptance_criteria[0] as { id: string }).id = 'AC-001';
  const findings = runStageChecks(
    'requirements',
    'src/stages/requirements',
    artifact,
    context(),
    UNIONS_CHECKS
  );
  const dup = findings.filter((f) => f.check === 'unique-ids' && f.target.includes(' + '));
  assert.equal(dup.length, 1);
  assert.equal(dup[0].severity, 'blocking');
  assert.equal(dup[0].category, 'structural');
  assert.match(dup[0].finding, /Duplicate ID 'AC-001'/);
  assert.match(dup[0].finding, /functional_requirements\[0\]\.acceptance_criteria\[0\]/);
  assert.match(dup[0].finding, /functional_requirements\[1\]\.acceptance_criteria\[0\]/);
});

test('unions group: cross-path duplicate names both containing requirements (AC-010 preview)', () => {
  const artifact = nestedCriteriaDoc();
  (artifact.non_functional_requirements[0].acceptance_criteria[0] as { id: string }).id = 'AC-001';
  const findings = runStageChecks(
    'requirements',
    'src/stages/requirements',
    artifact,
    context(),
    UNIONS_CHECKS
  );
  const dup = findings.filter((f) => f.check === 'unique-ids' && f.target.includes(' + '));
  assert.equal(dup.length, 1);
  assert.match(dup[0].finding, /Duplicate ID 'AC-001'/);
  assert.match(dup[0].finding, /functional_requirements\[0\]\.acceptance_criteria\[0\]/);
  assert.match(dup[0].finding, /non_functional_requirements\[0\]\.acceptance_criteria\[0\]/);
});

test('plain-name arrays keep per-array scope and finding text alongside unions groups', () => {
  const artifact = nestedCriteriaDoc();
  artifact.functional_requirements.push({ ...artifact.functional_requirements[0] });
  const findings = runStageChecks(
    'requirements',
    'src/stages/requirements',
    artifact,
    context(),
    UNIONS_CHECKS
  );
  const dup = findings.filter((f) => f.check === 'unique-ids');
  // The copied FR trips the plain-name per-array scope; its copied criterion
  // trips the unions group scope. Both findings appear, each in its own shape.
  assert.equal(dup.length, 2);
  const plain = dup.find((f) => !f.target.includes(' + '));
  const union = dup.find((f) => f.target.includes(' + '));
  assert.equal(plain?.finding, "Duplicate ID 'FR-001' in 'functional_requirements'");
  assert.equal(plain?.target, 'functional_requirements[].id');
  assert.match(union?.finding || '', /Duplicate ID 'AC-001' at /);
});

test('ref-exists resolves path entries in to.arrays against the target document', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-refpath-'));
  try {
    fs.writeFileSync(
      path.join(root, 'requirements.yaml'),
      [
        'functional_requirements:',
        '  - id: FR-001',
        '    description: The system shall create a device record.',
        '    acceptance_criteria:',
        '      - id: AC-001',
        '        statement: Given none, When submitted, Then 201.',
        '        category: happy',
        'non_functional_requirements:',
        '  - id: NFR-001',
        '    description: The endpoint shall respond within 500 ms.',
        '    acceptance_criteria:',
        '      - id: AC-002',
        '        statement: Given load, When measured, Then under 500 ms.',
        '        category: boundary',
        '',
      ].join('\n')
    );

    const checks: StructuralChecksDoc = {
      version: 1,
      checks: [
        {
          check: 'ref-exists',
          params: {
            from: { array: 'tasks', field: 'acceptance_ids' },
            to: {
              file: 'requirements.yaml',
              arrays: [
                'functional_requirements[].acceptance_criteria',
                'non_functional_requirements[].acceptance_criteria',
              ],
              field: 'id',
            },
          },
        },
      ],
    };

    const artifact = {
      tasks: [
        { id: 'TASK-001', acceptance_ids: ['AC-001', 'AC-002'] },
        { id: 'TASK-002', acceptance_ids: ['AC-999'] },
      ],
    };

    const findings = runStageChecks('planning', 'src/stages/planning', artifact, context(root), checks);
    const refFindings = findings.filter((f) => f.check === 'ref-exists');
    assert.equal(refFindings.length, 1);
    assert.equal(
      refFindings[0].finding,
      "TASK-002 references missing acceptance_ids value 'AC-999' in requirements.yaml"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('path-addressed ref-exists: an FR-nested reference resolves (AC-016)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-refpath-'));
  try {
    fs.writeFileSync(
      path.join(root, 'requirements.yaml'),
      [
        'functional_requirements:',
        '  - id: FR-001',
        '    description: The system shall create a device record.',
        '    acceptance_criteria:',
        '      - id: AC-001',
        '        statement: Given none, When submitted, Then 201.',
        '        category: happy',
        'non_functional_requirements: []',
        '',
      ].join('\n')
    );
    const checks: StructuralChecksDoc = {
      version: 1,
      checks: [
        {
          check: 'ref-exists',
          params: {
            from: { array: 'tasks', field: 'acceptance_ids' },
            to: {
              file: 'requirements.yaml',
              arrays: [
                'functional_requirements[].acceptance_criteria',
                'non_functional_requirements[].acceptance_criteria',
              ],
              field: 'id',
            },
          },
        },
      ],
    };
    const artifact = { tasks: [{ id: 'TASK-001', acceptance_ids: ['AC-001'] }] };
    assert.deepEqual(
      runStageChecks('planning', 'src/stages/planning', artifact, context(root), checks),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('path-addressed ref-exists: a missing reference is a blocking finding (AC-017)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-refpath-'));
  try {
    fs.writeFileSync(
      path.join(root, 'requirements.yaml'),
      [
        'functional_requirements:',
        '  - id: FR-001',
        '    description: The system shall create a device record.',
        '    acceptance_criteria:',
        '      - id: AC-001',
        '        statement: Given none, When submitted, Then 201.',
        '        category: happy',
        'non_functional_requirements: []',
        '',
      ].join('\n')
    );
    const checks: StructuralChecksDoc = {
      version: 1,
      checks: [
        {
          check: 'ref-exists',
          params: {
            from: { array: 'tasks', field: 'acceptance_ids' },
            to: {
              file: 'requirements.yaml',
              arrays: [
                'functional_requirements[].acceptance_criteria',
                'non_functional_requirements[].acceptance_criteria',
              ],
              field: 'id',
            },
          },
        },
      ],
    };
    const artifact = { tasks: [{ id: 'TASK-001', acceptance_ids: ['AC-042'] }] };
    const findings = runStageChecks('planning', 'src/stages/planning', artifact, context(root), checks);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].check, 'ref-exists');
    assert.equal(findings[0].severity, 'blocking');
    assert.equal(
      findings[0].finding,
      "TASK-001 references missing acceptance_ids value 'AC-042' in requirements.yaml"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('path-addressed ref-exists: an NFR-nested reference resolves through the union (AC-018)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-refpath-'));
  try {
    fs.writeFileSync(
      path.join(root, 'requirements.yaml'),
      [
        'functional_requirements: []',
        'non_functional_requirements:',
        '  - id: NFR-001',
        '    description: The endpoint shall respond within 500 ms.',
        '    acceptance_criteria:',
        '      - id: AC-002',
        '        statement: Given load, When measured, Then under 500 ms.',
        '        category: boundary',
        '',
      ].join('\n')
    );
    const checks: StructuralChecksDoc = {
      version: 1,
      checks: [
        {
          check: 'ref-exists',
          params: {
            from: { array: 'tasks', field: 'acceptance_ids' },
            to: {
              file: 'requirements.yaml',
              arrays: [
                'functional_requirements[].acceptance_criteria',
                'non_functional_requirements[].acceptance_criteria',
              ],
              field: 'id',
            },
          },
        },
      ],
    };
    const artifact = { tasks: [{ id: 'TASK-001', acceptance_ids: ['AC-002'] }] };
    assert.deepEqual(
      runStageChecks('planning', 'src/stages/planning', artifact, context(root), checks),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the catalog registers exactly ten named checks with referenced-by absent (AC-014)', () => {
  const catalog = Object.keys(CHECK_CATALOG).sort();
  assert.deepEqual(catalog, [
    'all-tasks-terminal',
    'dependency-acyclic',
    'dependency-order',
    'duplicate-refs',
    'forbidden-words',
    'given-when-then',
    'ref-exists',
    'required-note-for-status',
    'sentence-count',
    'unique-ids',
  ]);
  assert.equal(catalog.length, 10);
});

test('a stage still declaring referenced-by fails startup with the unknown-check error (AC-015)', () => {
  const checks: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'referenced-by',
        params: {
          array: 'acceptance_criteria',
          by: [{ array: 'functional_requirements', ref_field: 'ac_ids' }],
        },
      },
    ],
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
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes('src/stages/requirements') &&
        message.includes("unknown check 'referenced-by'")
      );
    }
  );
});

test('forbidden-words resolves multi-segment leaf paths through the resolver', () => {
  const checks: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'forbidden-words',
        params: {
          fields: ['functional_requirements[].acceptance_criteria[].statement'],
        },
      },
    ],
  };

  const artifact = nestedCriteriaDoc();
  (artifact.functional_requirements[0].acceptance_criteria[0].statement as string) =
    'Given none, When submitted, Then the response is fast.';
  const findings = runStageChecks(
    'requirements',
    'src/stages/requirements',
    artifact,
    context(),
    checks
  );
  const fw = findings.filter((f) => f.check === 'forbidden-word');
  assert.equal(fw.length, 1);
  assert.equal(fw[0].severity, 'blocking');
  assert.equal(fw[0].target, 'functional_requirements[0].acceptance_criteria[0].statement');
  assert.match(fw[0].finding, /fast/);
});
