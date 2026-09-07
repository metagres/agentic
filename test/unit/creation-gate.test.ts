import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createChangeDir, CreationBlockedError } from '../../src/scripts/lib/kinds/authoring.ts';
import { getStageById } from '../../src/scripts/lib/stage-registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function freshProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-creation-gate-'));
}

function runCli(tmp: string, args: string[]) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return {
    out: JSON.parse(res.stdout) as Record<string, any>,
    status: res.status as number,
  };
}

function writeAcceptedRequirements(changeRoot: string): void {
  fs.mkdirSync(changeRoot, { recursive: true });
  fs.writeFileSync(
    path.join(changeRoot, 'requirements.yaml'),
    [
      'metadata:',
      '  id: REQ-001',
      '  title: Accepted requirements',
      '  stage: requirements',
      '  status: accepted',
      '  version: 0.1.0',
      '  created: "2026-01-01"',
      '  updated: "2026-01-01"',
      '',
    ].join('\n'),
    'utf8'
  );
}

// ---------------------------------------------------------------------------
// Path 1 (AC-014): blocked creation — an unsatisfied gate returns the blocked
// STAGE_GATE_BLOCKED envelope and writes no artifact file.
// ---------------------------------------------------------------------------

test('blocked creation: unsatisfied gate returns STAGE_GATE_BLOCKED and writes no artifact (CLI)', () => {
  const tmp = freshProject();

  const { out, status } = runCli(tmp, ['design', '--request', 'Add device registration']);

  assert.equal(status, 1, JSON.stringify(out));
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.step, 'blocked', JSON.stringify(out));
  assert.equal(out.errors[0].code, 'STAGE_GATE_BLOCKED');

  const unsatisfied = out.data.unsatisfied_requirements as Record<string, string>[];
  assert.ok(Array.isArray(unsatisfied) && unsatisfied.length > 0, JSON.stringify(out));
  assert.equal(unsatisfied[0].stage, 'requirements-review');
  assert.equal(unsatisfied[0].artifact, 'requirements.yaml');
  assert.equal(unsatisfied[0].status, 'missing');
  assert.equal(unsatisfied[0].required, 'accepted');

  const changesDir = path.join(tmp, 'docs', 'changes');
  assert.ok(
    !fs.existsSync(changesDir) || fs.readdirSync(changesDir).length === 0,
    'no change directory may be created for a gated, unsatisfied first creation'
  );
});

// ---------------------------------------------------------------------------
// Path 2 (AC-015): allowed creation — an accepted predecessor yields an
// instantiated artifact and a non-blocked envelope.
// ---------------------------------------------------------------------------

test('allowed creation: accepted predecessor creates the artifact normally (CLI)', () => {
  const tmp = freshProject();
  const changeRoot = path.join(tmp, 'docs', 'changes', 'gated-change');
  writeAcceptedRequirements(changeRoot);

  const { out, status } = runCli(tmp, [
    'design',
    '--change',
    'gated-change',
    '--request',
    'Add device registration',
  ]);

  assert.equal(status, 0, JSON.stringify(out));
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  const parsed = fs.readFileSync(path.join(changeRoot, 'design.yaml'), 'utf8');
  assert.ok(parsed.length > 0, 'design.yaml must exist after a satisfied gate');
  assert.match(parsed, /stage: design/);
  assert.match(parsed, /status: draft/);
});

// ---------------------------------------------------------------------------
// Path 3 (AC-016): root-stage skip — an empty requires list creates without
// gate evaluation.
// ---------------------------------------------------------------------------

test('root-stage skip: empty requires creates with no predecessor artifacts present (CLI)', () => {
  const tmp = freshProject();

  const { out, status } = runCli(tmp, ['requirements', '--request', 'Add device registration']);

  assert.equal(status, 0, JSON.stringify(out));
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  const changeRoot = out.data.change_root as string;
  assert.ok(fs.existsSync(path.join(changeRoot, 'requirements.yaml')));
});

// ---------------------------------------------------------------------------
// Path 4 (AC-008, AC-016): re-rooting criterion — through a synthetic stages
// directory, a stage with an empty requires list is allowed purely from
// descriptor data with zero engine change.
// ---------------------------------------------------------------------------

interface FixtureResult {
  tmp: string;
  stagesDir: string;
}

function makeGateFixtures(): FixtureResult {
  const tmp = freshProject();
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

  // Root authoring stage (empty requires) tracked by the review stage.
  writeStage('fixture-root', authoringFiles('fixture-root'));

  // Review stage gating the child.
  writeStage('fixture-review', {
    'stage.yaml': [
      'version: 1',
      'id: fixture-review',
      'kind: review',
      'title: fixture-review',
      'artifact: fixture-root.yaml',
      'status_field: status',
      'reviews: fixture-root',
      'review_file: fixture-review.yaml',
      '',
    ].join('\n'),
    'steps.yaml': 'version: 1\nsteps: {}\n',
  });

  // Child authoring stage gated on the review stage.
  writeStage(
    'fixture-gated',
    authoringFiles('fixture-gated', ['requires:', '  - fixture-review'])
  );

  // Re-rooted twin of fixture-gated: the identical descriptor with the
  // requires list deleted — the re-rooting criterion of DEC-003.
  writeStage('fixture-open', authoringFiles('fixture-open'));

  return { tmp, stagesDir };
}

test('re-rooting: deleting requires from the descriptor allows first creation with zero engine change', () => {
  const { tmp, stagesDir } = makeGateFixtures();

  const gated = getStageById(tmp, 'fixture-gated', stagesDir);
  assert.ok(gated, 'fixture-gated stage record must load');
  assert.deepEqual(gated.requires, ['fixture-review']);

  // The gated descriptor is blocked while the tracked predecessor is missing.
  assert.throws(
    () => createChangeDir(tmp, 'Create gated artifact', gated as never),
    (err: unknown) => {
      assert.ok(err instanceof CreationBlockedError);
      assert.equal(err.gate.unsatisfied.length, 1);
      assert.equal(err.gate.unsatisfied[0].stage, 'fixture-review');
      assert.equal(err.gate.unsatisfied[0].required, 'accepted');
      return true;
    }
  );
  const changesDir = path.join(tmp, 'docs', 'changes');
  assert.ok(
    !fs.existsSync(changesDir) || fs.readdirSync(changesDir).length === 0,
    'a blocked gated creation must not create the change directory'
  );

  // The re-rooted twin — identical descriptor minus the requires list — is
  // allowed purely from descriptor data through the same engine code path.
  // (The allowed-creation transition for a satisfied gate is covered by the
  // CLI path-2 test against the real stage contracts.)
  const open = getStageById(tmp, 'fixture-open', stagesDir);
  assert.ok(open, 'fixture-open stage record must load');
  assert.deepEqual(open.requires, []);

  const openRoot = createChangeDir(tmp, 'Create open artifact', open as never);
  assert.ok(fs.existsSync(path.join(openRoot, 'fixture-open.yaml')));
});
