import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { validateWithSchema } from '../../src/scripts/lib/schema.ts';
import { validRequirements } from '../helpers/artifacts.ts';
import { buildStepVars, renderStepHelp, renderTemplate } from '../../src/scripts/lib/step-render.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function tmpRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(tmp: string, args: string[], input?: string) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function assertEnvelopeShape(payload: Record<string, unknown>) {
  const findings = validateWithSchema(payload, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, []);
}

// ---------------------------------------------------------------------------
// Shared renderer helpers (step-render.ts)
// ---------------------------------------------------------------------------

test('renderTemplate substitutes known vars and keeps unknown placeholders literal', () => {
  const out = renderTemplate(
    'run {{SDLC}} review --change {{change_name}} on {{stage}} for {{target}}',
    { SDLC: 'node sdlc.js', change_name: 'demo', stage: 'design-review' }
  );
  assert.equal(out, 'run node sdlc.js review --change demo on design-review for {{target}}');
});

test('buildStepVars carries the shared vars contract with a change-name fallback', () => {
  const withoutChange = buildStepVars('design-review', null, '/tmp');
  assert.equal(withoutChange.change_name, '<change-name>');
  assert.equal(withoutChange.stage, 'design-review');
  assert.ok(withoutChange.SDLC.startsWith('node '));

  const withChange = buildStepVars('design-review', '/tmp/docs/changes/demo', '/tmp', {
    target: 'design',
  });
  assert.equal(withChange.change_name, 'demo');
  assert.equal(withChange.target, 'design');
});

test('renderStepHelp renders title, markdown, and templated commands', () => {
  const help = renderStepHelp(
    'accept',
    {
      title: 'Accept',
      markdown: 'Accept {{change_name}} via {{SDLC}}.',
      commands: ['{{SDLC}} design-review --change {{change_name}} --accept'],
    },
    { SDLC: 'node sdlc.js', change_name: 'demo', stage: 'design-review' }
  );
  assert.equal(help.title, 'Accept');
  assert.equal(help.markdown, 'Accept demo via node sdlc.js.');
  assert.deepEqual(help.commands, ['node sdlc.js design-review --change demo --accept']);
  assert.equal(help.exit_criteria, null);

  const missing = renderStepHelp('ghost', undefined, {});
  assert.equal(missing.title, 'ghost');
  assert.equal(missing.markdown, '');
  assert.deepEqual(missing.commands, []);
});

// ---------------------------------------------------------------------------
// Review kind: step ids and step_help come from steps.yaml
// ---------------------------------------------------------------------------

function makeProject(): string {
  const tmp = tmpRepo('agentic-step-');
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'architecture.md'),
    '# architecture.md\n',
    'utf8'
  );
  return tmp;
}

function setupReadyChange(request: string): { tmp: string; changeDir: string } {
  const tmp = makeProject();
  const changeDir = request
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  assert.equal(runCli(tmp, ['init', '--change', changeDir]).state, 'ok');
  let out = runCli(tmp, ['requirements', '--change', changeDir]);
  out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request }))
  );
  assert.notEqual(out.state, 'blocked');
  out = runCli(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));
  return { tmp, changeDir };
}

test('review envelopes carry the detected steps.yaml step id', () => {
  const { tmp, changeDir } = setupReadyChange('Add device registration');

  // Missing --change: the engagement backstop (never a step).
  const missing = runCli(tmp, ['requirements-review']);
  assertEnvelopeShape(missing);
  assert.equal(missing.step, 'blocked');
  assert.equal(missing.errors[0].code, 'MISSING_CHANGE_DIR');
  assert.match(missing.instructions, /Change identification is the skill's job/);

  // Bare invocation: the review step.
  const bare = runCli(tmp, ['requirements-review', '--change', changeDir]);
  assertEnvelopeShape(bare);
  assert.equal(bare.step, 'review');
  assert.match(bare.instructions, /Run the requirements review against the tracked artifact\./);

  // Rejection verdict with failed semantic checks: the reject step.
  const checks = readYaml(
    path.join(root, 'src', 'stages', 'requirements', 'semantic-checks.yaml')
  ).checks as string[];
  const failures = path.join(tmp, 'failures.yaml');
  fs.writeFileSync(
    failures,
    `- check: ${JSON.stringify(checks[0])}\n  evidence: "The statement proposes a solution."\n`,
    'utf8'
  );
  const rejected = runCli(tmp, [
    'requirements-review',
    '--change',
    changeDir,
    '--reject',
    '--failures',
    failures,
  ]);
  assertEnvelopeShape(rejected);
  assert.equal(rejected.step, 'reject');
  assert.match(rejected.instructions, /Reject the requirements artifact/);
});

test('an accepting verdict renders the accept step over a bare --accept', () => {
  const { tmp, changeDir } = setupReadyChange('Add device registration');

  const out = runCli(tmp, ['requirements-review', '--change', changeDir, '--accept']);
  assertEnvelopeShape(out);
  assert.equal(out.step, 'accept');
  assert.equal(out.state, 'complete');
  assert.match(out.instructions, /Accept the requirements artifact/);
  assert.match(out.instructions, /review was accepted/);
  assert.equal(out.data.status, 'accepted');
  assert.deepEqual(out.data.failures, []);
});

test('review --help-step renders the detected step definition with substituted commands', () => {
  const { tmp, changeDir } = setupReadyChange('Add device registration');

  const out = runCli(tmp, ['requirements-review', '--change', changeDir, '--help-step']);
  assertEnvelopeShape(out);
  const help = out.data.step_help as {
    title: string;
    markdown: string;
    commands: string[];
  };
  assert.ok(help, '--help-step must include step_help');
  assert.equal(help.title, 'Review');
  assert.ok(help.markdown.includes('Run the requirements review against the tracked artifact.'));
  assert.ok(Array.isArray(help.commands) && help.commands.length > 0);
  for (const command of help.commands) {
    assert.ok(!command.includes('{{'), `commands must be rendered: ${command}`);
    // Steps.yaml commands are help pointers (W4): the agent discovers the
    // invocation surface via --help / --describe-step.
    assert.ok(command.includes('--help'), `commands carry the help pointer: ${command}`);
    assert.ok(command.includes('--describe-step'), `commands carry the describe-step pointer: ${command}`);
  }

  // Without the flag the payload stays lean.
  const lean = runCli(tmp, ['requirements-review', '--change', changeDir]);
  assert.ok(!('step_help' in lean.data), 'step_help must be absent by default');
});

// ---------------------------------------------------------------------------
// Tasks kind: step ids and guardrails come from steps.yaml
// ---------------------------------------------------------------------------

function seedPlan(
  tmp: string,
  changeDir: string,
  taskIds: string[],
  status: string
): string {
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);
  fs.mkdirSync(changeRoot, { recursive: true });
  const tasks = taskIds
    .map(
      (id) =>
        [
          `  - id: ${id}`,
          '    title: Do the thing',
          '    description: Implement the thing.',
          '    type: implementation',
          `    status: ${status}`,
          '    depends_on: []',
          '',
        ].join('\n')
    )
    .join('');
  const body = [
    'metadata:',
    '  id: PLAN-001',
    '  title: Test plan',
    '  stage: planning',
    '  status: accepted',
    '  version: 0.1.0',
    'tasks:',
    tasks,
  ].join('\n');
  fs.writeFileSync(path.join(changeRoot, 'plan.yaml'), body, 'utf8');
  return changeDir;
}

test('tasks envelopes carry the detected steps.yaml step id', () => {
  const tmp = tmpRepo('agentic-tasks-');

  // Missing --change: the engagement backstop (never a step).
  const missing = runCli(tmp, ['implementation']);
  assertEnvelopeShape(missing);
  assert.equal(missing.step, 'blocked');
  assert.equal(missing.errors[0].code, 'MISSING_CHANGE_DIR');
  assert.match(missing.instructions, /Change identification is the skill's job/);

  const changeDir = seedPlan(tmp, 'step-tasks', ['TASK-001', 'TASK-002'], 'pending');

  // Bare invocation: the progress step with the guardrails from steps.yaml.
  const progress = runCli(tmp, ['implementation', '--change', changeDir]);
  assertEnvelopeShape(progress);
  assert.equal(progress.step, 'progress');
  assert.match(progress.instructions, /One task per turn:/);
  assert.match(progress.instructions, /Planning quality guardrails/);
  assert.match(progress.instructions, /Implementation progress summary\./);

  // Task update with work remaining: still the progress step, rendered as a
  // terse ack (mutation, implementation still in progress).
  const updated = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-id',
    'TASK-001',
    '--status',
    'done',
    '--note',
    'Implemented and verified.',
  ]);
  assertEnvelopeShape(updated);
  assert.equal(updated.step, 'progress');
  assert.equal(updated.instructions, 'Task TASK-001 is now done.');
  assert.doesNotMatch(updated.instructions, /Planning quality guardrails/);

  // Last task terminal: the complete step invites the review gate.
  const complete = runCli(tmp, [
    'implementation',
    '--change',
    changeDir,
    '--task-id',
    'TASK-002',
    '--status',
    'done',
    '--note',
    'Implemented and verified.',
  ]);
  assertEnvelopeShape(complete);
  assert.equal(complete.step, 'complete');
  assert.equal(complete.state, 'complete');
  assert.match(complete.instructions, /All tasks are complete or skipped\./);
  assert.match(complete.instructions, /Run the implementation review gate\./);
});

// ---------------------------------------------------------------------------
// Aggregator kind: step ids come from steps.yaml
// ---------------------------------------------------------------------------

function seedAcceptedImplementation(tmp: string, changeDir: string): string {
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);
  fs.mkdirSync(changeRoot, { recursive: true });
  const body = [
    'metadata:',
    '  id: PLAN-001',
    '  title: Test plan',
    '  stage: planning',
    '  status: accepted',
    '  version: 0.1.0',
    '  implementation_status: accepted',
    'tasks:',
    '  - id: TASK-001',
    '    title: Do the thing',
    '    description: Implement the thing.',
    '    type: implementation',
    '    status: done',
    '    depends_on: []',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(changeRoot, 'plan.yaml'), body, 'utf8');
  return changeDir;
}

test('aggregator envelopes carry the detected steps.yaml step id', () => {
  const tmp = tmpRepo('agentic-agg-');

  // Missing --change: the engagement backstop (never a step).
  const missing = runCli(tmp, ['knowledge-extraction']);
  assertEnvelopeShape(missing);
  assert.equal(missing.step, 'blocked');
  assert.equal(missing.errors[0].code, 'MISSING_CHANGE_DIR');
  assert.match(missing.instructions, /Change identification is the skill's job/);

  const changeDir = seedAcceptedImplementation(tmp, 'step-agg');

  // Default invocation: the docs_delta step, with the regenerate-then-apply
  // hint from the steps.yaml markdown.
  const listing = runCli(tmp, ['knowledge-extraction', '--change', changeDir]);
  assertEnvelopeShape(listing);
  assert.equal(listing.step, 'docs_delta');
  assert.match(listing.instructions, /First regenerate the mechanical parts of docs\/current/);
  assert.match(listing.instructions, /--complete/);

  // --complete: the complete step.
  const done = runCli(tmp, ['knowledge-extraction', '--change', changeDir, '--complete']);
  assertEnvelopeShape(done);
  assert.equal(done.step, 'complete');
  assert.equal(done.state, 'complete');
  assert.match(done.instructions, /Mark the synchronization complete/);
  assert.match(done.instructions, /Documentation synchronization is complete\./);
});

// The steps.yaml files must no longer carry the unused next_action field.
test('no stage steps.yaml declares a next_action field', () => {
  const stagesDir = path.join(root, 'src', 'stages');
  const offenders: string[] = [];
  for (const entry of fs.readdirSync(stagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const stepsPath = path.join(stagesDir, entry.name, 'steps.yaml');
    if (!fs.existsSync(stepsPath)) continue;
    const doc = readYaml(stepsPath) as { steps?: Record<string, Record<string, unknown>> } | null;
    for (const [stepId, step] of Object.entries(doc?.steps || {})) {
      if ('next_action' in step) offenders.push(`${entry.name}/${stepId}`);
    }
  }
  assert.deepEqual(offenders, []);
});
