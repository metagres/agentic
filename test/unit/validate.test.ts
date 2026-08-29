import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateArtifact } from '../../src/scripts/lib/validate.ts';
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
      '  - { id: FR-001 }',
      'non_functional_requirements:',
      '  - { id: NFR-001 }',
      'acceptance_criteria:',
      '  - { id: AC-001 }',
      '  - { id: AC-002 }',
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
