import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { safeReadYaml } from '../../src/scripts/lib/context.ts';
import hooks from '../../src/stages/requirements/hooks.ts';
import { validRequirements } from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

const SHIPPED_POLICY = path.join(
  root,
  'src',
  'stages',
  'requirements',
  'requirements-policy.yaml'
);

// A valid policy matching the shipped FR-004 vocabulary (DM-001), used to build
// fixture stage folders for the gate and loader tests.
const VALID_POLICY = `version: 1

discovery:
  lenses:
    - stakeholder
    - scope
    - interface
    - behavior
    - data
    - constraint
    - failure
    - outcome

  clarity:
    clear:
      required_lenses:
        - failure
        - constraint
      min_resolved_questions: 3
    partial:
      required_lenses:
        - stakeholder
        - interface
        - data
        - failure
        - constraint
      min_resolved_questions: 5
    vague:
      required_lenses:
        - stakeholder
        - scope
        - interface
        - behavior
        - data
        - constraint
        - failure
        - outcome
      min_resolved_questions: 8
`;

function fixtureStageFolder(policyContent: string | null): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'req-policy-'));
  const folder = path.join(tmp, 'requirements');
  fs.mkdirSync(folder, { recursive: true });
  if (policyContent !== null) {
    fs.writeFileSync(path.join(folder, 'requirements-policy.yaml'), policyContent, 'utf8');
  }
  return folder;
}

function mockEnv(folder: string, artifact: Record<string, unknown>) {
  return {
    stage: { folder },
    artifact,
    readYaml: safeReadYaml,
    args: {},
  };
}

// An artifact whose discovery_log satisfies the partial floor (the five
// required lenses plus five resolved questions) with no confirmation flags.
function floorArtifact(overrides: Record<string, unknown> = {}) {
  const lens = ['stakeholder', 'interface', 'data', 'failure', 'constraint'];
  return {
    metadata: { clarity: 'partial' },
    discovery_log: lens.map((l, i) => ({
      id: `DL-00${i + 1}`,
      question: `q${i + 1}`,
      answer: `a${i + 1}`,
      lens: l,
      resolved: true,
    })),
    scenarios: [],
    assumptions: [],
    ...overrides,
  };
}

test('the shipped requirements-policy.yaml pins the FR-004 vocabulary and thresholds', () => {
  const doc = readYaml(SHIPPED_POLICY) as {
    discovery: {
      lenses: string[];
      clarity: Record<string, { required_lenses: string[]; min_resolved_questions: number }>;
    };
  };

  assert.deepEqual(doc.discovery.lenses, [
    'stakeholder',
    'scope',
    'interface',
    'behavior',
    'data',
    'constraint',
    'failure',
    'outcome',
  ]);

  assert.deepEqual(Object.keys(doc.discovery.clarity).sort(), ['clear', 'partial', 'vague']);
  assert.deepEqual(doc.discovery.clarity.clear.required_lenses, ['failure', 'constraint']);
  assert.equal(doc.discovery.clarity.clear.min_resolved_questions, 3);
  assert.deepEqual(doc.discovery.clarity.partial.required_lenses, [
    'stakeholder',
    'interface',
    'data',
    'failure',
    'constraint',
  ]);
  assert.equal(doc.discovery.clarity.partial.min_resolved_questions, 5);
  assert.deepEqual(doc.discovery.clarity.vague.required_lenses, [
    'stakeholder',
    'scope',
    'interface',
    'behavior',
    'data',
    'constraint',
    'failure',
    'outcome',
  ]);
  assert.equal(doc.discovery.clarity.vague.min_resolved_questions, 8);
});

test('startup throws STAGE_POLICY_MISSING when the policy file is absent', () => {
  const folder = fixtureStageFolder(null);
  const env = mockEnv(folder, floorArtifact());
  assert.throws(
    () => (hooks as { startup: (e: unknown) => void }).startup(env),
    (err: unknown) => {
      const e = err as { code?: string; message?: string };
      assert.equal(e.code, 'STAGE_POLICY_MISSING');
      assert.match(String(e.message), /requirements-policy.yaml is missing/);
      return true;
    }
  );
});

test('startup throws STAGE_POLICY_INVALID for an unparsable policy file', () => {
  const folder = fixtureStageFolder('a: [1,\n');
  const env = mockEnv(folder, floorArtifact());
  assert.throws(
    () => (hooks as { startup: (e: unknown) => void }).startup(env),
    (err: unknown) => {
      const e = err as { code?: string; message?: string };
      assert.equal(e.code, 'STAGE_POLICY_INVALID');
      assert.match(String(e.message), /could not be parsed/);
      return true;
    }
  );
});

test('startup throws STAGE_POLICY_INVALID naming the offending field for shape violations', () => {
  const cases: [string, string][] = [
    [`version: 2\n${VALID_POLICY.replace('version: 1', '')}`, 'version'],
    ['version: 1\ndiscovery:\n  lenses: []\n  clarity: {}\n', 'discovery.lenses'],
    [
      `version: 1\ndiscovery:\n  lenses: [stakeholder, stakeholder]\n  clarity: {}\n`,
      'discovery.lenses',
    ],
    [
      `version: 1\ndiscovery:\n  lenses: [stakeholder]\n  clarity:\n    clear:\n      required_lenses: [failure]\n      min_resolved_questions: 1\n`,
      'discovery.clarity',
    ],
    [
      `version: 1\ndiscovery:\n  lenses: [stakeholder, failure, constraint]\n  clarity:\n    clear:\n      required_lenses: [data]\n      min_resolved_questions: 1\n    partial:\n      required_lenses: [stakeholder]\n      min_resolved_questions: 2\n    vague:\n      required_lenses: [stakeholder]\n      min_resolved_questions: 3\n`,
      'discovery.clarity.clear.required_lenses',
    ],
    [
      `version: 1\ndiscovery:\n  lenses: [stakeholder]\n  clarity:\n    clear:\n      required_lenses: [stakeholder]\n      min_resolved_questions: 0\n    partial:\n      required_lenses: [stakeholder]\n      min_resolved_questions: 2\n    vague:\n      required_lenses: [stakeholder]\n      min_resolved_questions: 3\n`,
      'discovery.clarity.clear.min_resolved_questions',
    ],
  ];

  for (const [content, expectedField] of cases) {
    const folder = fixtureStageFolder(content);
    const env = mockEnv(folder, floorArtifact());
    assert.throws(
      () => (hooks as { startup: (e: unknown) => void }).startup(env),
      (err: unknown) => {
        const e = err as { code?: string; message?: string };
        assert.equal(e.code, 'STAGE_POLICY_INVALID');
        assert.match(String(e.message), new RegExp(expectedField.replaceAll('.', '\\.')));
        return true;
      },
      `expected field ${expectedField} to be named for policy:\n${content}`
    );
  }
});

test('a passing floor without confirmation leaves the step at discovery (AC-005)', () => {
  const folder = fixtureStageFolder(VALID_POLICY);
  const env = mockEnv(folder, floorArtifact());
  const extraStep = (hooks as { extraStep: (e: unknown) => string | null }).extraStep;
  assert.equal(extraStep(env), 'discovery');
});

test('complete-step confirmation advances past discovery and scenarios (AC-006, AC-008)', () => {
  const folder = fixtureStageFolder(VALID_POLICY);
  const artifact = floorArtifact({
    metadata: { clarity: 'partial', discovery_reviewed: true },
  });
  const env = mockEnv(folder, artifact);
  const extraStep = (hooks as { extraStep: (e: unknown) => string | null }).extraStep;

  // Confirmed discovery, empty scenarios not yet reviewed -> scenarios.
  assert.equal(extraStep(env), 'scenarios');

  // Open scenario keeps the step at scenarios (AC-007).
  const withOpen = floorArtifact({
    metadata: { clarity: 'partial', discovery_reviewed: true, scenarios_reviewed: true },
    scenarios: [
      {
        id: 'SC-001',
        statement: 'Given no device exists, When a registration arrives, Then the system accepts it.',
        category: 'happy',
        status: 'open',
        outcome: 'ac',
      },
    ],
  });
  const envOpen = mockEnv(folder, withOpen);
  assert.equal(extraStep(envOpen), 'scenarios');

  // All scenarios resolved, assumptions reviewed -> machine advances past
  // scenarios to assumptions (AC-008) even without the confirmation flag.
  const allResolved = floorArtifact({
    metadata: { clarity: 'partial', discovery_reviewed: true },
    scenarios: [
      {
        id: 'SC-001',
        statement: 'Given no device exists, When a registration arrives, Then the system accepts it.',
        category: 'happy',
        status: 'resolved',
        outcome: 'ac',
      },
    ],
    assumptions: [{ type: 'verified', text: 'The database stores device records.' }],
  });
  const envResolved = mockEnv(folder, allResolved);
  assert.equal(extraStep(envResolved), null);
});

test('an artifact clarity outside the policy anchors fails the gate loudly', () => {
  const folder = fixtureStageFolder(VALID_POLICY);
  const env = mockEnv(
    folder,
    floorArtifact({ metadata: { clarity: 'ambiguous' } })
  );
  const getExtraData = (hooks as { getExtraData: (e: unknown) => { discovery_gate: unknown } }).getExtraData;
  const data = getExtraData(env);
  const gate = data.discovery_gate as {
    passed: boolean;
    clarity_valid: boolean;
    clarity: string;
  };
  assert.equal(gate.passed, false);
  assert.equal(gate.clarity_valid, false);
  assert.equal(gate.clarity, 'ambiguous');
});

test('recordAnswer rejects a lens outside the policy vocabulary with UNKNOWN_LENS', () => {
  const folder = fixtureStageFolder(VALID_POLICY);
  const env = mockEnv(folder, { metadata: {}, discovery_log: [] });
  env.args = { lens: 'design', question: 'q', answer: 'a' };
  const recordAnswer = (hooks as { recordAnswer: (e: unknown) => void }).recordAnswer;
  assert.throws(
    () => recordAnswer(env),
    (err: unknown) => {
      const e = err as { code?: string; message?: string };
      assert.equal(e.code, 'UNKNOWN_LENS');
      assert.match(String(e.message), /stakeholder/);
      assert.match(String(e.message), /outcome/);
      return true;
    }
  );
});

test('recordAnswer accepts a vocabulary lens and appends the next DL id', () => {
  const folder = fixtureStageFolder(VALID_POLICY);
  const artifact = {
    metadata: {},
    discovery_log: [{ id: 'DL-001', question: 'q', answer: 'a', lens: 'stakeholder', resolved: true }],
  };
  const env = mockEnv(folder, artifact);
  env.args = { lens: 'data', question: 'Is there a data model?', answer: 'Yes.' };
  const recordAnswer = (hooks as { recordAnswer: (e: unknown) => void }).recordAnswer;
  recordAnswer(env);
  const log = (env.artifact as { discovery_log: unknown[] }).discovery_log;
  assert.equal(log.length, 2);
  const last = log[1] as Record<string, unknown>;
  assert.equal(last.id, 'DL-002');
  assert.equal(last.lens, 'data');
  assert.equal(last.resolved, true);
});

function runCli(tmp: string, args: string[], input?: string) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('complete-step --step discovery and scenarios set the confirmation flags (FR-011, AC-014)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-cs-'));
  let out = runCli(tmp, ['requirements', '--request', 'Add device registration']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  const artifact = validRequirements({}) as Record<string, unknown>;
  (artifact.metadata as Record<string, unknown>).discovery_reviewed = false;
  (artifact.metadata as Record<string, unknown>).scenarios_reviewed = false;

  out = runCli(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = runCli(tmp, ['requirements', '--dir', changeDir, '--complete-step', '--step', 'discovery']);
  assert.equal(out.state, 'in_progress', JSON.stringify(out));

  out = runCli(tmp, ['requirements', '--dir', changeDir, '--complete-step', '--step', 'scenarios']);
  assert.equal(out.state, 'in_progress', JSON.stringify(out));

  const saved = readYaml(path.join(changeRoot, 'requirements.yaml')) as {
    metadata: { discovery_reviewed: boolean; scenarios_reviewed: boolean };
  };
  assert.equal(saved.metadata.discovery_reviewed, true);
  assert.equal(saved.metadata.scenarios_reviewed, true);
});
