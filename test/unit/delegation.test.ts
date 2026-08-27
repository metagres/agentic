import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { delegationDirective } from '../../src/scripts/lib/delegation.ts';
import { normalizeEnvelope } from '../../src/scripts/lib/cli.ts';
import { getStageById } from '../../src/scripts/lib/stage-registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

interface ComposerStage {
  id: string;
  kind: 'authoring' | 'review' | 'tasks' | 'aggregator';
  agent: string | null;
}

function stage(overrides: Partial<ComposerStage> = {}): ComposerStage {
  return {
    id: 'requirements',
    kind: 'authoring',
    agent: 'requirements-analyst',
    ...overrides,
  };
}

test('a null agent binding yields no directive', () => {
  assert.equal(delegationDirective(stage({ agent: null })), null);
});

test('the directive names the bound agent and instructs delegation (AC-001)', () => {
  const directive = delegationDirective(stage());

  assert.ok(directive);
  assert.match(directive, /requirements-analyst/);
  assert.match(directive, /delegate this stage to requirements-analyst/);
});

test('the directive carries the conditional self clause (AC-002)', () => {
  const directive = delegationDirective(stage()) as string;

  assert.match(
    directive,
    /if you are already requirements-analyst, proceed running the stage yourself/
  );
});

test('the directive carries the unavailability fallback clause (AC-011)', () => {
  const directive = delegationDirective(stage()) as string;

  assert.match(
    directive,
    /if requirements-analyst is not present or not invocable in your runtime, proceed running the stage yourself/
  );
});

test('the review-kind variant directs the round to the named reviewer agent (AC-004)', () => {
  const directive = delegationDirective({
    id: 'design-review',
    kind: 'review',
    agent: 'stage-reviewer',
  }) as string;

  assert.match(directive, /stage-reviewer/);
  assert.match(directive, /must be performed by stage-reviewer/);
  assert.match(directive, /not by the agent that authored the artifact/);
});

test('the review-kind variant contains no author-performs-review instruction (AC-005)', () => {
  const directive = delegationDirective({
    id: 'design-review',
    kind: 'review',
    agent: 'stage-reviewer',
  }) as string;

  assert.doesNotMatch(directive, /perform the review yourself/);
  assert.doesNotMatch(directive, /run the review yourself/);
  assert.doesNotMatch(directive, /perform the review round yourself/);
});

test('arbitrary fixture agent ids interpolate verbatim (AC-010)', () => {
  const directive = delegationDirective({
    id: 'fixture-stage',
    kind: 'tasks',
    agent: 'fixture-alpha',
  }) as string;

  assert.match(directive, /fixture-alpha/);
  assert.match(
    directive,
    /if you are already fixture-alpha, proceed running the stage yourself/
  );
  assert.match(
    directive,
    /if fixture-alpha is not present or not invocable in your runtime, proceed running the stage yourself/
  );
});

test('identical inputs produce identical text', () => {
  const first = delegationDirective(stage());
  const second = delegationDirective(stage());

  assert.equal(first, second);
});

test('a bound-stage envelope prepends the directive naming the bound agent (AC-001)', () => {
  const env = normalizeEnvelope({
    workflow: 'requirements',
    step: 'authoring',
    state: 'ok',
    instructions: 'Step guidance for the authoring loop.',
    data: {},
  });

  const requirements = getStageById(root, 'requirements');
  assert.ok(requirements);
  assert.equal(requirements.agent, 'requirements-analyst');
  const expected = `${delegationDirective(requirements)}\n\nStep guidance for the authoring loop.`;

  assert.equal(env.instructions, expected);
  assert.match(env.instructions, /requirements-analyst/);
});

test('cross-cutting envelopes carry no directive and stay byte-identical (AC-003)', () => {
  for (const id of ['status', 'feedback', 'doctor']) {
    const env = normalizeEnvelope({
      workflow: id,
      step: 'run',
      state: 'ok',
      instructions: `Cross-cutting guidance for ${id}.`,
      data: {},
    });

    assert.equal(env.instructions, `Cross-cutting guidance for ${id}.`, id);
    assert.doesNotMatch(env.instructions, /bound to the dedicated agent|bound to the reviewer agent/);
  }
});

test('an unknown workflow id emits no directive', () => {
  const env = normalizeEnvelope({
    workflow: 'no-such-stage',
    instructions: 'Usage guidance.',
  });

  assert.equal(env.instructions, 'Usage guidance.');
});

test('the envelope top level is exactly the seven frozen fields (AC-008)', () => {
  const env = normalizeEnvelope({
    workflow: 'requirements',
    step: 'authoring',
    state: 'ok',
    instructions: 'Guidance.',
    data: { change_root: '/tmp/x' },
    errors: [],
    warnings: [],
  });

  assert.deepEqual(Object.keys(env).sort(), [
    'data',
    'errors',
    'instructions',
    'state',
    'step',
    'warnings',
    'workflow',
  ]);
});

test('a bound-stage envelope introduces no additional top-level key (AC-009)', () => {
  const env = normalizeEnvelope({
    workflow: 'requirements',
    instructions: 'Guidance.',
  });

  assert.deepEqual(Object.keys(env).sort(), [
    'data',
    'errors',
    'instructions',
    'state',
    'step',
    'warnings',
    'workflow',
  ]);
  assert.equal(env.workflow, 'requirements');
});

// ---------------------------------------------------------------------------
// Fixture-based composition through the funnel (CMP-006, DEC-007): fixture
// stage directories bound to arbitrary agent ids prove the directive is
// composed from declarative bindings with no hardcoded agent paths (AC-010).
// ---------------------------------------------------------------------------

function makeDelegationFixtures(): { tmp: string; stagesDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-deleg-'));
  const stagesDir = path.join(tmp, 'stages');

  const writeStage = (folder: string, files: Record<string, string>) => {
    fs.mkdirSync(path.join(stagesDir, folder), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(stagesDir, folder, file), content, 'utf8');
    }
  };

  const authoringFiles = (id: string, extraDescriptorLines: string[] = []) => ({
    'stage.yaml': [
      'version: 1',
      `id: ${id}`,
      'kind: authoring',
      `title: ${id}`,
      `artifact: ${id}.yaml`,
      'status_field: status',
      ...extraDescriptorLines,
      '',
    ].join('\n'),
    'structural-checks.yaml': 'version: 1\nchecks: []\n',
    'schema.yaml': '{ "type": "object" }\n',
    'template.yaml': 'metadata:\n  id: FIX-001\n',
    'steps.yaml': 'version: 1\nsteps: {}\n',
    'semantic-checks.yaml': 'version: 1\nchecks: []\n',
  });

  // Authoring stage bound to an arbitrary fixture agent id.
  writeStage(
    'fixture-stage',
    authoringFiles('fixture-stage', ['agent: fixture-alpha'])
  );

  // Authoring stage with a null binding.
  writeStage('fixture-open', authoringFiles('fixture-open'));

  // Review-kind stage bound to another arbitrary fixture agent id.
  writeStage('fixture-review', {
    'stage.yaml': [
      'version: 1',
      'id: fixture-review',
      'kind: review',
      'title: fixture-review',
      'artifact: fixture-stage.yaml',
      'status_field: status',
      'reviews: fixture-stage',
      'review_file: fixture-review.yaml',
      'agent: fixture-beta',
      '',
    ].join('\n'),
    'steps.yaml': 'version: 1\nsteps: {}\n',
  });

  return { tmp, stagesDir };
}

test('fixture stages bound to arbitrary agent ids compose directives naming those ids (AC-010)', () => {
  const { tmp, stagesDir } = makeDelegationFixtures();

  const env = normalizeEnvelope(
    {
      workflow: 'fixture-stage',
      step: 'authoring',
      state: 'ok',
      instructions: 'Fixture step guidance.',
      data: {},
    },
    stagesDir
  );

  assert.match(env.instructions, /^Stage 'fixture-stage' is bound to the dedicated agent 'fixture-alpha'/);
  assert.match(env.instructions, /delegate this stage to fixture-alpha/);
  assert.match(env.instructions, /if you are already fixture-alpha, proceed running the stage yourself/);
  assert.match(env.instructions, /if fixture-alpha is not present or not invocable in your runtime, proceed running the stage yourself/);

  // The registry itself resolves from the injected fixture directory.
  const resolved = getStageById(tmp, 'fixture-stage', stagesDir);
  assert.ok(resolved);
  assert.equal(resolved.agent, 'fixture-alpha');

  // Original guidance stays intact below the prepended directive paragraph.
  assert.ok(env.instructions.endsWith('\n\nFixture step guidance.'));
});

test('a fixture review-kind envelope directs the round to the named reviewer agent (AC-004, AC-005)', () => {
  const { stagesDir } = makeDelegationFixtures();

  const env = normalizeEnvelope(
    {
      workflow: 'fixture-review',
      step: 'review',
      state: 'ok',
      instructions: 'Review round guidance.',
      data: {},
    },
    stagesDir
  );

  assert.match(env.instructions, /fixture-beta/);
  assert.match(env.instructions, /must be performed by fixture-beta/);
  assert.match(env.instructions, /not by the agent that authored the artifact/);
  assert.doesNotMatch(env.instructions, /perform the review yourself/);
  assert.doesNotMatch(env.instructions, /run the review yourself/);
});

test('a null-binding fixture stage emits a byte-identical seven-field envelope (AC-003, AC-008)', () => {
  const { stagesDir } = makeDelegationFixtures();

  const payload = {
    workflow: 'fixture-open',
    step: 'init',
    state: 'ok',
    instructions: 'Unbound stage guidance.',
    data: { change_root: '/tmp/change' },
    errors: [],
    warnings: [],
  };

  const env = normalizeEnvelope(payload, stagesDir);

  assert.deepEqual(env, {
    workflow: 'fixture-open',
    step: 'init',
    state: 'ok',
    instructions: 'Unbound stage guidance.',
    data: { change_root: '/tmp/change' },
    errors: [],
    warnings: [],
  });
});

test('cross-cutting and unknown ids stay silent against the fixture-driven funnel (AC-003)', () => {
  const { stagesDir } = makeDelegationFixtures();

  for (const id of ['status', 'feedback', 'doctor', 'no-such-stage']) {
    const env = normalizeEnvelope(
      { workflow: id, instructions: `${id} guidance.` },
      stagesDir
    );

    assert.equal(env.instructions, `${id} guidance.`, id);
  }
});

test('a fixture-driven bound envelope keeps exactly the seven top-level fields (AC-008)', () => {
  const { stagesDir } = makeDelegationFixtures();

  const env = normalizeEnvelope(
    { workflow: 'fixture-stage', instructions: 'Guidance.' },
    stagesDir
  );

  assert.deepEqual(Object.keys(env).sort(), [
    'data',
    'errors',
    'instructions',
    'state',
    'step',
    'warnings',
    'workflow',
  ]);
});
