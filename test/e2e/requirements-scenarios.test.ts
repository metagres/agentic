import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { validRequirements } from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function makeTmpProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-scen-'));
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'index.md'),
    '# Current Docs Index\n| File | Purpose | When to Read | Notes |\n|---|---|---|---|\n| docs/current/overview.md | System overview | Start here | Fixture |\n',
    'utf8'
  );
  return tmp;
}

function run(tmp: string, args: string[], input?: string) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
    timeout: 30000,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

// validRequirements with discovery confirmed and a clean scenarios section
// whose entries the test manipulates.
function scenarioArtifact(overrides: Record<string, unknown> = {}) {
  const artifact = validRequirements({}) as Record<string, unknown>;
  const meta = artifact.metadata as Record<string, unknown>;
  meta.discovery_reviewed = true;
  meta.scenarios_reviewed = false;
  artifact.scenarios = [
    {
      id: 'SC-001',
      statement: 'Given a new device, When a registration request arrives, Then the device is registered.',
      category: 'happy',
      status: 'open',
      outcome: 'ac',
    },
    {
      id: 'SC-002',
      statement: 'Given a malformed device identifier, When a registration request arrives, Then the system rejects the request.',
      category: 'negative',
      status: 'open',
      outcome: 'question',
    },
  ];
  return { ...artifact, ...overrides };
}

test('scenarios flow loops back into discovery, promotes ac outcomes, and passes review', () => {
  const tmp = makeTmpProject();

  let out = run(tmp, ['requirements', '--request', 'Add device registration']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  // An open scenario keeps the step at scenarios (AC-007).
  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(scenarioArtifact())
  );
  assert.equal(out.step, 'scenarios', JSON.stringify(out));

  // Loop back: the negative scenario exposes a question, recorded through
  // --record-answer; the scenario links it via question_id and resolves.
  out = run(tmp, [
    'requirements',
    '--dir',
    changeDir,
    '--record-answer',
    '--lens',
    'behavior',
    '--question',
    'How must the system treat a malformed device identifier?',
    '--answer',
    'The endpoint rejects the request with 400 and logs the attempt.',
  ]);
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  // Apply the resolutions and promotion to the artifact as saved on disk (it
  // now carries the DL-007 answer recorded above).
  const artifact = readYaml(path.join(changeRoot, 'requirements.yaml')) as Record<string, unknown>;
  const scenarios = artifact.scenarios as Record<string, unknown>[];
  scenarios[0].status = 'resolved';
  scenarios[1].status = 'resolved';
  scenarios[1].outcome = 'question';
  scenarios[1].question_id = 'DL-007'; // recorded above

  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  // All scenarios resolved and discovery confirmed: the machine advances past
  // scenarios (AC-008).
  assert.notEqual(out.step, 'scenarios', JSON.stringify(out));

  // Promote SC-001 (outcome ac) during drafting: add the acceptance criterion,
  // link parent_id, extend the FR ac_ids, and back-fill the scenario ac_id.
  const fr = artifact.functional_requirements as Record<string, unknown>[];
  (fr[0].ac_ids as string[]).push('AC-003');
  (artifact.acceptance_criteria as Record<string, unknown>[]).push({
    id: 'AC-003',
    statement:
      'Given a new device, When a registration request arrives, Then the system returns 201 and a device identifier.',
    parent_id: 'FR-001',
  });
  scenarios[0].ac_id = 'AC-003';

  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = run(tmp, ['requirements', '--dir', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['requirements-review', '--dir', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const saved = readYaml(path.join(changeRoot, 'requirements.yaml')) as {
    scenarios: { id: string; status: string; ac_id?: string; question_id?: string }[];
    acceptance_criteria: { id: string }[];
  };
  assert.equal(saved.scenarios[0].ac_id, 'AC-003');
  assert.equal(saved.scenarios[1].question_id, 'DL-007');
  assert.ok(saved.acceptance_criteria.some((ac) => ac.id === 'AC-003'));
});

test('a scenario whose ac_id references a missing acceptance criterion blocks finalize', () => {
  const tmp = makeTmpProject();
  let out = run(tmp, ['requirements', '--request', 'Add device registration']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  const artifact = scenarioArtifact();
  const scenarios = artifact.scenarios as Record<string, unknown>[];
  scenarios[0].status = 'resolved';
  scenarios[0].ac_id = 'AC-999'; // dangling link
  scenarios[1].status = 'resolved';
  scenarios[1].outcome = 'out_of_scope';

  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  // The dangling link surfaces as a blocking ref-exists finding immediately.
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.step, 'validation', JSON.stringify(out));
  assert.match(JSON.stringify(out), /SC-001|AC-999/);

  out = run(tmp, ['requirements', '--dir', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.match(JSON.stringify(out), /SC-001|AC-999/);
});

test('a scenario whose question_id references a missing discovery entry blocks finalize', () => {
  const tmp = makeTmpProject();
  let out = run(tmp, ['requirements', '--request', 'Add device registration']);
  const changeDir = path.basename(out.data.change_root);

  const artifact = scenarioArtifact();
  const scenarios = artifact.scenarios as Record<string, unknown>[];
  scenarios[0].status = 'resolved';
  scenarios[0].outcome = 'question';
  scenarios[0].question_id = 'DL-999'; // dangling link
  scenarios[1].status = 'resolved';
  scenarios[1].outcome = 'out_of_scope';

  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  // The dangling link surfaces as a blocking ref-exists finding immediately.
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.step, 'validation', JSON.stringify(out));
  assert.match(JSON.stringify(out), /SC-001|DL-999/);

  out = run(tmp, ['requirements', '--dir', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.match(JSON.stringify(out), /SC-001|DL-999/);
});

test('an in-flight artifact without scenarios or flags routes to discovery then scenarios', () => {
  const tmp = makeTmpProject();

  let out = run(tmp, ['requirements', '--request', 'Add device registration']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  // Pre-change artifact: no scenarios section, no confirmation flags, and a
  // discovery_log that predates the data lens (schema-valid under NFR-002).
  const artifact = validRequirements({}) as Record<string, unknown>;
  delete artifact.scenarios;
  const meta = artifact.metadata as Record<string, unknown>;
  delete meta.discovery_reviewed;
  delete meta.scenarios_reviewed;
  (artifact.discovery_log as Record<string, unknown>[]).pop(); // remove the data-lens answer

  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  // Partial clarity now requires the data lens: the gate fails, so the step
  // routes to discovery with instructions to confirm convergence (AC-018).
  assert.equal(out.step, 'discovery', JSON.stringify(out));

  // Restore the data-lens answer and confirm discovery explicitly.
  (artifact.discovery_log as Record<string, unknown>[]).push({
    id: 'DL-007',
    question: 'What data is stored per device?',
    answer: 'A device record with an external identifier.',
    lens: 'data',
    resolved: true,
  });
  meta.discovery_reviewed = true;

  out = run(
    tmp,
    ['requirements', '--dir', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  // Empty scenarios not yet reviewed: the step routes to scenarios (AC-018).
  assert.equal(out.step, 'scenarios', JSON.stringify(out));

  // Explicit confirmation of the empty scenario set advances the machine.
  out = run(tmp, ['requirements', '--dir', changeDir, '--complete-step', '--step', 'scenarios']);
  assert.equal(out.step, 'ready', JSON.stringify(out));

  // The artifact remains schema-valid throughout.
  out = run(tmp, ['requirements', '--dir', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));
});
