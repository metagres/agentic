import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateArtifact, validateCheckDeclarations } from '../../src/scripts/lib/validate.ts';
import { getStageById } from '../../src/scripts/lib/stage-registry.ts';
import type { StructuralChecksDoc } from '../../src/scripts/lib/checks/index.ts';
import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { validRequirements, validDesign, validPlan } from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function makeChangeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-validate-'));
}

test('a valid requirements artifact produces no findings', () => {
  const changeRoot = makeChangeRoot();
  const findings = validateArtifact('requirements', validRequirements(), root, changeRoot);
  assert.deepEqual(findings, []);
});

test('a schema violation produces a schema finding first (AC-019)', () => {
  const changeRoot = makeChangeRoot();
  const artifact = validRequirements();
  artifact.functional_requirements[0].id = 'FR-XXX'; // violates ^FR-[0-9]{3}$
  const findings = validateArtifact('requirements', artifact, root, changeRoot);
  const schema = findings.filter((f) => f.check === 'schema');
  assert.ok(schema.length > 0, JSON.stringify(findings));
  assert.equal(schema[0].severity, 'blocking');
  assert.equal(schema[0].category, 'structural');
});

test('a lint violation produces a named-check finding after schema findings (AC-019)', () => {
  const changeRoot = makeChangeRoot();
  const artifact = validRequirements();
  artifact.functional_requirements[0].id = 'FR-XXX'; // schema violation
  artifact.problem_statement = 'The system must be fast for all users.'; // lint violation
  const findings = validateArtifact('requirements', artifact, root, changeRoot);

  assert.ok(findings.length > 1, JSON.stringify(findings));
  assert.equal(findings[0].check, 'schema', 'schema findings come first');
  assert.equal(findings[0].severity, 'blocking');
  assert.equal(findings[0].category, 'structural');
  assert.ok(
    findings.some((f) => f.check === 'forbidden-word' && f.severity === 'blocking'),
    JSON.stringify(findings)
  );
});

test('no cross-artifact version equality findings (AC-015, DEC-010)', () => {
  const changeRoot = makeChangeRoot();
  fs.writeFileSync(
    path.join(changeRoot, 'requirements.yaml'),
    'metadata:\n  version: 9.9.9\nfunctional_requirements: []\nnon_functional_requirements: []\nacceptance_criteria: []\n',
    'utf8'
  );

  // based_on_requirements deliberately mismatches requirements.yaml's version;
  // the metadata field is provenance only and must not produce a finding.
  const design = validDesign({ reqVersion: '0.0.1' });
  const findings = validateArtifact('design', design, root, changeRoot);
  assert.ok(
    !findings.some((f) => /based_on_requirements/.test(f.finding)),
    JSON.stringify(findings)
  );
});

test('design ref-exists resolves against requirements.yaml in the change root', () => {
  const changeRoot = makeChangeRoot();
  fs.writeFileSync(
    path.join(changeRoot, 'requirements.yaml'),
    [
      'metadata: { version: 0.1.0 }',
      'functional_requirements:',
      '  - { id: FR-001 }',
      'non_functional_requirements:',
      '  - { id: NFR-001 }',
      '',
    ].join('\n'),
    'utf8'
  );

  const design = validDesign();
  design.traceability.push({ requirement_id: 'FR-099', component_ids: ['CMP-001'] });

  const findings = validateArtifact('design', design, root, changeRoot);
  const ref = findings.filter((f) => f.check === 'ref-exists');
  assert.equal(ref.length, 1);
  assert.equal(ref[0].severity, 'blocking');
  assert.match(ref[0].finding, /FR-099/);
});

test('planning checks validate tasks against requirements and design artifacts', () => {
  const changeRoot = makeChangeRoot();
  fs.writeFileSync(
    path.join(changeRoot, 'requirements.yaml'),
    [
      'metadata: { version: 0.1.0 }',
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
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(changeRoot, 'design.yaml'),
    'metadata: { version: 0.1.0 }\ndecisions:\n  - { id: DEC-001 }\n',
    'utf8'
  );

  const plan = validPlan();
  plan.tasks[0].covers.push('FR-099');
  plan.tasks[0].acceptance_ids.push('AC-099');
  plan.tasks[0].design_refs.push('DEC-099');

  const findings = validateArtifact('planning', plan, root, changeRoot);
  const refs = findings.filter((f) => f.check === 'ref-exists');
  assert.equal(refs.length, 3);
});

test('unknown stage id produces no findings', () => {
  const changeRoot = makeChangeRoot();
  const findings = validateArtifact('does-not-exist', validRequirements(), root, changeRoot);
  assert.deepEqual(findings, []);
});

test('a plan without milestones or risks fails with two blocking schema findings', () => {
  const changeRoot = makeChangeRoot();
  const plan = validPlan() as Record<string, unknown>;
  delete plan.milestones;
  delete plan.risks;
  const findings = validateArtifact('planning', plan, root, changeRoot);
  const missing = findings.filter(
    (f) =>
      f.check === 'schema' &&
      /must have required property '(milestones|risks)'/.test(f.finding)
  );
  assert.equal(missing.length, 2, JSON.stringify(findings));
  for (const f of missing) {
    assert.equal(f.severity, 'blocking');
    assert.equal(f.category, 'structural');
  }
});

test('a milestone without done_when is a blocking schema finding', () => {
  const changeRoot = makeChangeRoot();
  const plan = validPlan();
  const milestone = plan.milestones[0] as Record<string, unknown>;
  delete milestone.done_when;
  const findings = validateArtifact('planning', plan, root, changeRoot);
  assert.ok(
    findings.some(
      (f) => f.check === 'schema' && f.severity === 'blocking' && /done_when/.test(f.finding)
    ),
    JSON.stringify(findings)
  );
});

test('a risk without mitigation is a blocking schema finding', () => {
  const changeRoot = makeChangeRoot();
  const plan = validPlan();
  (plan.risks as Record<string, unknown>[]).push({
    id: 'RISK-001',
    description: 'The endpoint contract could drift from the design.',
  });
  const findings = validateArtifact('planning', plan, root, changeRoot);
  assert.ok(
    findings.some(
      (f) => f.check === 'schema' && f.severity === 'blocking' && /mitigation/.test(f.finding)
    ),
    JSON.stringify(findings)
  );
});

test('a milestone referencing an unknown task is a blocking ref-exists finding', () => {
  const changeRoot = makeChangeRoot();
  const plan = validPlan();
  plan.milestones[0].tasks.push('TASK-999');
  const findings = validateArtifact('planning', plan, root, changeRoot);
  const refs = findings.filter((f) => f.check === 'ref-exists');
  assert.equal(refs.length, 1, JSON.stringify(findings));
  assert.equal(refs[0].severity, 'blocking');
  assert.match(refs[0].finding, /TASK-999/);
});

test('duplicate milestone ids are a blocking unique-ids finding', () => {
  const changeRoot = makeChangeRoot();
  const plan = validPlan();
  plan.milestones.push({ ...plan.milestones[0] });
  const findings = validateArtifact('planning', plan, root, changeRoot);
  const dups = findings.filter((f) => f.check === 'unique-ids');
  assert.equal(dups.length, 1, JSON.stringify(findings));
  assert.equal(dups[0].severity, 'blocking');
  assert.match(dups[0].finding, /MS-001/);
});

test('a plan with empty milestones and risks arrays passes planning validation', () => {
  const changeRoot = makeChangeRoot();
  const plan = validPlan();
  plan.milestones = [];
  const findings = validateArtifact('planning', plan, root, changeRoot);
  assert.deepEqual(findings, []);
});

// ---------------------------------------------------------------------------
// Declaration path validation (CMP-003, DEC-003, AC-009)
// ---------------------------------------------------------------------------

const REQUIREMENTS_STAGE = getStageById(root, 'requirements') as NonNullable<
  ReturnType<typeof getStageById>
>;

test('the current requirements declarations pass declaration path validation', () => {
  const checksDoc = readYaml(
    path.join(root, 'src', 'stages', 'requirements', 'structural-checks.yaml')
  ) as StructuralChecksDoc;
  assert.doesNotThrow(() => validateCheckDeclarations(REQUIREMENTS_STAGE, checksDoc, root));
});

test('a [].-bearing string outside path-bearing slots aborts naming the stage folder and declaration', () => {
  const checksDoc: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'sentence-count',
        params: { field: 'tasks[].title', min: 1, max: 6 },
      },
    ],
  };
  assert.throws(
    () => validateCheckDeclarations(REQUIREMENTS_STAGE, checksDoc, root),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes('src/stages/requirements') &&
        message.includes("check 'sentence-count'") &&
        message.includes('unsupported path')
      );
    }
  );
});

test('a malformed selector in a path-bearing slot aborts naming the stage folder and declaration', () => {
  // Intermediate segment 'acceptance_criteria' without [] violates the
  // segment([].segment)* grammar.
  const checksDoc: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'unique-ids',
        params: {
          arrays: ['functional_requirements[].acceptance_criteria.statement'],
        },
      },
    ],
  };
  assert.throws(
    () => validateCheckDeclarations(REQUIREMENTS_STAGE, checksDoc, root),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes('src/stages/requirements') &&
        message.includes("check 'unique-ids'") &&
        message.includes("intermediate segment 'acceptance_criteria' must bear []")
      );
    }
  );
});

test('a selector naming an undeclared schema property aborts naming the stage folder and declaration', () => {
  const checksDoc: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'unique-ids',
        params: {
          arrays: ['functional_requirements[].missing_nested'],
        },
      },
    ],
  };
  assert.throws(
    () => validateCheckDeclarations(REQUIREMENTS_STAGE, checksDoc, root),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes('src/stages/requirements') &&
        message.includes("check 'unique-ids'") &&
        message.includes("property 'missing_nested' is not declared")
      );
    }
  );
});

test('a collection selector ending at a non-array property aborts', () => {
  const checksDoc: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'unique-ids',
        params: {
          arrays: ['functional_requirements[].description'],
        },
      },
    ],
  };
  assert.throws(
    () => validateCheckDeclarations(REQUIREMENTS_STAGE, checksDoc, root),
    /must be array-typed/
  );
});

test('a leaf selector ending at a non-string property aborts', () => {
  const checksDoc: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'forbidden-words',
        params: {
          fields: [{ path: 'functional_requirements[].acceptance_criteria' }],
        },
      },
    ],
  };
  assert.throws(
    () => validateCheckDeclarations(REQUIREMENTS_STAGE, checksDoc, root),
    /must be string-typed/
  );
});

test('a ref-exists to.file no stage owns falls back to grammar checks only', () => {
  // 'unknown-file.yaml' is owned by no stage: the selector is grammatically
  // valid, so validation passes even though the property is undeclared in
  // every stage schema.
  const checksDoc: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'ref-exists',
        params: {
          from: { array: 'tasks', field: 'acceptance_ids' },
          to: {
            file: 'unknown-file.yaml',
            arrays: ['missing_property[].whatever'],
            field: 'id',
          },
        },
      },
    ],
  };
  assert.doesNotThrow(() => validateCheckDeclarations(REQUIREMENTS_STAGE, checksDoc, root));
});

test('a ref-exists to.file owned by a stage validates to.arrays against the owning schema', () => {
  // requirements.yaml is owned by the requirements stage: the same selector
  // that passes the grammar-only fallback now aborts against that schema.
  const checksDoc: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'ref-exists',
        params: {
          from: { array: 'tasks', field: 'acceptance_ids' },
          to: {
            file: 'requirements.yaml',
            arrays: ['missing_property[].whatever'],
            field: 'id',
          },
        },
      },
    ],
  };
  assert.throws(
    () => validateCheckDeclarations(REQUIREMENTS_STAGE, checksDoc, root),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes("check 'ref-exists'") &&
        message.includes("property 'missing_property' is not declared")
      );
    }
  );
});

test('a ref-exists to.arrays path resolving through the owning stage schema passes', () => {
  // 'functional_requirements[].acceptance_criteria' resolves against the
  // requirements schema: functional_requirements is array-typed and its items
  // declare the nested array-typed acceptance_criteria through the criterion
  // definitions reference.
  const checksDoc: StructuralChecksDoc = {
    version: 1,
    checks: [
      {
        check: 'ref-exists',
        params: {
          from: { array: 'tasks', field: 'acceptance_ids' },
          to: {
            file: 'requirements.yaml',
            arrays: ['functional_requirements[].acceptance_criteria'],
            field: 'id',
          },
        },
      },
    ],
  };
  assert.doesNotThrow(() => validateCheckDeclarations(REQUIREMENTS_STAGE, checksDoc, root));
});

// ---------------------------------------------------------------------------
// Nested requirements contract (CMP-004, CMP-007 coverage list)
// ---------------------------------------------------------------------------

test('retired fields render the three pinned boolean-false finding strings verbatim (AC-003, AC-004)', () => {
  const changeRoot = makeChangeRoot();
  const artifact = validRequirements() as Record<string, unknown> & {
    acceptance_criteria?: unknown;
    functional_requirements: Record<string, unknown>[];
  };
  // Re-introduce all three retired fields on an otherwise nested artifact.
  artifact.acceptance_criteria = [];
  artifact.functional_requirements[0].ac_ids = ['AC-001'];
  (
    artifact.functional_requirements[0].acceptance_criteria as Record<string, unknown>[]
  )[0].parent_id = 'FR-001';

  const findings = validateArtifact('requirements', artifact, root, changeRoot);
  const strings = findings.map((f) => f.finding);
  assert.ok(
    strings.includes('/acceptance_criteria boolean schema is false'),
    JSON.stringify(strings)
  );
  assert.ok(
    strings.includes('/functional_requirements/0/ac_ids boolean schema is false'),
    JSON.stringify(strings)
  );
  assert.ok(
    strings.includes(
      '/functional_requirements/0/acceptance_criteria/0/parent_id boolean schema is false'
    ),
    JSON.stringify(strings)
  );
});

test('an empty nested acceptance_criteria array is a blocking schema finding (AC-005)', () => {
  const changeRoot = makeChangeRoot();
  const artifact = validRequirements() as Record<string, unknown> & {
    functional_requirements: Record<string, unknown>[];
  };
  artifact.functional_requirements[0].acceptance_criteria = [];
  const findings = validateArtifact('requirements', artifact, root, changeRoot);
  assert.ok(
    findings.some(
      (f) =>
        f.check === 'schema' &&
        f.severity === 'blocking' &&
        /acceptance_criteria.*must NOT have fewer than 1 items/.test(f.finding)
    ),
    JSON.stringify(findings)
  );
});

test('a criterion missing a required property is a blocking schema finding (AC-006)', () => {
  const changeRoot = makeChangeRoot();
  const artifact = validRequirements() as Record<string, unknown> & {
    functional_requirements: Record<string, unknown>[];
  };
  const criterion = artifact.functional_requirements[0]
    .acceptance_criteria[0] as Record<string, unknown>;
  delete criterion.category;
  const findings = validateArtifact('requirements', artifact, root, changeRoot);
  assert.ok(
    findings.some(
      (f) =>
        f.check === 'schema' &&
        f.severity === 'blocking' &&
        /acceptance_criteria\/0 must have required property 'category'/.test(f.finding)
    ),
    JSON.stringify(findings)
  );
});

test('the nested shape is recognized without parent_id or ac_ids (AC-001, AC-002)', () => {
  const changeRoot = makeChangeRoot();
  const artifact = validRequirements();
  const text = JSON.stringify(artifact);
  assert.ok(!text.includes('parent_id'), 'helper must not carry parent_id');
  assert.ok(!text.includes('ac_ids'), 'helper must not carry ac_ids');
  assert.ok(!('acceptance_criteria' in artifact), 'helper must not carry a top-level list');
  assert.deepEqual(validateArtifact('requirements', artifact, root, changeRoot), []);
});
