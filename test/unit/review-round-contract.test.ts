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

// The requirements stage's semantic-checks.yaml check list (DEC-003): the
// declared-check universe for requirements-review semantic failures.
const REQUIREMENTS_CHECKS = readYaml(
  path.join(root, 'src', 'stages', 'requirements', 'semantic-checks.yaml')
).checks as string[];

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

function makeProject(): string {
  const tmp = tmpRepo('agentic-round-');
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'index.md'),
    [
      '| File | Purpose | When to Read | Notes |',
      '|---|---|---|---|',
      '| docs/current/architecture.md | Tech stack | Structural changes | Fixture |',
      '| docs/current/api-contract.md | Endpoints | API changes | Fixture |',
      '| docs/current/glossary.md | Entities | Data layer changes | Fixture |',
      '| docs/current/capabilities.md | Features | Feature changes | Fixture |',
      '| docs/current/conventions.md | Patterns | Code writing | Fixture |',
      '| docs/current/operations.md | Build | Verification | Fixture |',
      '| docs/current/dependencies.md | Libraries | Dependency changes | Fixture |',
      '| docs/current/known-issues.md | Markers | Task estimation | Fixture |',
      '| docs/current/decisions.md | ADRs | Architectural changes | Fixture |',
      '',
    ].join('\n'),
    'utf8'
  );
  return tmp;
}

interface ReadyChange {
  tmp: string;
  changeRoot: string;
  changeDir: string;
}

/** Creates a change with a finalized (ready-for-review) requirements artifact. */
function setupReadyChange(request: string): ReadyChange {
  const tmp = makeProject();
  let out = runCli(tmp, ['requirements', '--request', request]);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);
  out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request }))
  );
  assert.notEqual(out.state, 'blocked');
  out = runCli(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));
  return { tmp, changeRoot, changeDir };
}

function reviewFile(rc: ReadyChange): string {
  return path.join(rc.changeRoot, 'requirements-review.yaml');
}

function readRounds(rc: ReadyChange): Record<string, unknown>[] {
  const doc = readYaml(reviewFile(rc)) as { rounds: Record<string, unknown>[] } | null;
  return doc?.rounds ?? [];
}

function readMeta(rc: ReadyChange): Record<string, unknown> {
  const doc = readYaml(reviewFile(rc)) as { metadata: Record<string, unknown> } | null;
  return doc?.metadata ?? {};
}

function artifactStatus(rc: ReadyChange): string {
  const artifact = readYaml(path.join(rc.changeRoot, 'requirements.yaml')) as {
    metadata: { status: string };
  };
  return artifact.metadata.status;
}

/**
 * Writes a --failures file with the given semantic failures. Entries are
 * {check, evidence} pairs; the check must be a declared check of the
 * requirements stage's semantic-checks.yaml. Returns the ABSOLUTE path;
 * callers pass it as-is (the --failures value resolves relative to the
 * process working directory, and the CLI runs with cwd = tmp).
 */
function writeFailuresFile(
  rc: ReadyChange,
  name: string,
  entries: { check: string; evidence: string }[],
  extra = ''
): string {
  const body =
    entries.length === 0
      ? '[]\n'
      : entries
          .map((e) => `- check: ${JSON.stringify(e.check)}\n  evidence: ${JSON.stringify(e.evidence)}\n`)
          .join('');
  const file = path.join(rc.tmp, name);
  fs.writeFileSync(file, `${body}${extra}`, 'utf8');
  return file;
}

function semanticFailure(rc: ReadyChange, i = 0, evidence = 'The statement proposes a solution, not the operator pain.'): { check: string; evidence: string } {
  return { check: REQUIREMENTS_CHECKS[i], evidence };
}

/** Introduces a blocking mechanical finding by duplicating an AC id on disk. */
function breakArtifact(rc: ReadyChange): void {
  const artifactPath = path.join(rc.changeRoot, 'requirements.yaml');
  const artifact = readYaml(artifactPath) as Record<string, unknown> & {
    functional_requirements: { acceptance_criteria: Record<string, unknown>[] }[];
    metadata: { status: string };
  };
  const criteria = artifact.functional_requirements[0].acceptance_criteria;
  criteria.push({ ...criteria[0] });
  artifact.metadata.status = 'ready-for-review';
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');
}

// ---------------------------------------------------------------------------
// Lifecycle: open / refresh / complete-in-place / append / legacy tolerance
// ---------------------------------------------------------------------------

test('bare invocation opens a round with merged status open and a mechanical block', () => {
  const rc = setupReadyChange('Add device registration');

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(out.state, 'ok');
  assert.equal(out.data.round, 1);
  assert.equal(out.data.status, 'open');
  assert.deepEqual(out.data.failures, []);

  const rounds = readRounds(rc);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].round, 1);
  assert.equal(rounds[0].status, 'open');
  assert.equal(rounds[0].mechanical_checks_passed, true);
  assert.deepEqual(rounds[0].failures, []);
  // The semantic checklist is not dispositioned by a bare invocation.
  assert.equal('semantic_checks_passed' in rounds[0], false);
  // The merged contract deletes decision, can_accept, rationale, and warnings.
  assert.equal('decision' in rounds[0], false);
  assert.equal('can_accept' in rounds[0], false);
  assert.equal('rationale' in rounds[0], false);
  assert.equal('warnings' in rounds[0], false);
});

test('a second bare invocation refreshes the open round in place keeping the same round number', () => {
  const rc = setupReadyChange('Add device registration');

  runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(out.data.round, 1);

  const rounds = readRounds(rc);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].round, 1);
  assert.equal(rounds[0].status, 'open');
});

test('a verdict completes the latest open round in place with no additional round', () => {
  const rc = setupReadyChange('Add device registration');

  runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--failures',
    writeFailuresFile(rc, 'failures.yaml', [semanticFailure(rc)]),
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.data.round, 1);
  assert.equal(artifactStatus(rc), 'rejected');

  const rounds = readRounds(rc);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].round, 1);
  assert.equal(rounds[0].status, 'rejected');
});

test('a verdict with no open round appends a complete round', () => {
  const rc = setupReadyChange('Add device registration');

  // Verdict without a prior bare invocation: no open round exists.
  let out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--failures',
    writeFailuresFile(rc, 'failures.yaml', [semanticFailure(rc)]),
  ]);
  assert.equal(out.data.round, 1);
  assert.equal(readRounds(rc).length, 1);

  // Recover and accept: still no open round, so the verdict appends round 2.
  out = runCli(
    rc.tmp,
    ['requirements', '--change', rc.changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ title: 'Device registration v2', request: 'Add device registration' }))
  );
  assert.notEqual(out.state, 'blocked');
  out = runCli(rc.tmp, ['requirements', '--change', rc.changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete');

  out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept']);
  assert.equal(out.state, 'complete');

  const rounds = readRounds(rc);
  assert.deepEqual(rounds.map((r) => r.status), ['rejected', 'accepted']);
  assert.deepEqual(rounds.map((r) => r.round), [1, 2]);
});

test('legacy rounds without a status field are treated as closed and left unmodified', () => {
  const rc = setupReadyChange('Add device registration');

  // Hand-write a legacy review file whose round lacks a status field.
  const legacy = [
    'metadata:',
    '  artifact: requirements.yaml',
    '  target: requirements',
    '  latest_round: 1',
    '  created: 2026-01-01',
    '  updated: 2026-01-01',
    '  latest_decision: review',
    'rounds:',
    '  - round: 1',
    '    reviewed_at: 2026-01-01T00:00:00.000Z',
    '    artifact_version: 0.1.0',
    '    decision: review',
    '    can_accept: true',
    '    mechanical:',
    '      valid: true',
    '      blocking_count: 0',
    '      findings: []',
    '    warnings: []',
    '',
  ].join('\n');
  fs.writeFileSync(reviewFile(rc), legacy, 'utf8');
  const legacyBefore = readRounds(rc)[0];

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(out.data.round, 2);

  const rounds = readRounds(rc);
  assert.equal(rounds.length, 2);
  // The legacy round is byte-identical: treated as closed, never modified.
  assert.deepEqual(rounds[0], legacyBefore);
  assert.equal(rounds[0].status, undefined);
  // The merged-status logic applies only to the newly written round.
  assert.equal(rounds[1].status, 'open');
});

// ---------------------------------------------------------------------------
// Merged status, valid flags, and metadata
// ---------------------------------------------------------------------------

test('bare --accept records the accepted round with failures [], both valid flags true, and latest_status', () => {
  const rc = setupReadyChange('Add device registration');

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept']);
  assert.equal(out.state, 'complete');
  assert.equal(out.data.status, 'accepted');
  assert.deepEqual(out.data.failures, []);
  assert.equal(out.data.artifact_status, 'accepted');

  const round = readRounds(rc)[0];
  assert.equal(round.status, 'accepted');
  assert.equal(round.mechanical_checks_passed, true);
  assert.equal(round.semantic_checks_passed, true);
  assert.deepEqual(round.failures, []);
  assert.equal(readMeta(rc).latest_status, 'accepted');
  assert.equal('latest_decision' in readMeta(rc), false);
});

test('a semantic rejection records semantic.valid false and the failed checks', () => {
  const rc = setupReadyChange('Add device registration');
  const failure = semanticFailure(rc);

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--failures',
    writeFailuresFile(rc, 'failures.yaml', [failure]),
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.data.status, 'rejected');

  const round = readRounds(rc)[0];
  assert.equal(round.status, 'rejected');
  assert.equal(round.mechanical_checks_passed, true);
  assert.equal(round.semantic_checks_passed, false);
  assert.deepEqual(round.failures, [failure]);
  assert.equal(readMeta(rc).latest_status, 'rejected');
});

test('a mechanical rejection records mechanical.valid false, no semantic block, and CLI-computed failures', () => {
  const rc = setupReadyChange('Add device registration');
  breakArtifact(rc);

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--reject']);
  assert.equal(out.data.status, 'rejected');
  assert.equal(out.data.artifact_status, 'rejected');

  const round = readRounds(rc)[0];
  assert.equal(round.status, 'rejected');
  assert.equal(round.mechanical_checks_passed, false);
  assert.equal('semantic_checks_passed' in round, false);
  const failures = round.failures as { check: string; evidence: string }[];
  assert.equal(failures.length > 0, true);
  for (const failure of failures) {
    assert.equal(typeof failure.check, 'string');
    assert.equal(typeof failure.evidence, 'string');
    assert.equal('severity' in failure, false);
    assert.equal('category' in failure, false);
    assert.equal('fix' in failure, false);
  }
  // The fix is folded into the evidence text.
  assert.ok(failures.some((f) => f.evidence.includes('Fix:')));
});

// ---------------------------------------------------------------------------
// Forced rejection on accept with mechanical failures
// ---------------------------------------------------------------------------

test('--accept with mechanical failures forces rejection: round rejected, artifact flipped, blocked envelope', () => {
  const rc = setupReadyChange('Add device registration');
  breakArtifact(rc);

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept']);
  assert.equal(out.state, 'blocked');
  assert.equal(out.data.status, 'rejected');
  assert.equal(out.data.artifact_status, 'rejected');
  assert.equal(out.errors[0].code, 'REVIEW_NOT_PASSING');
  assert.match(out.instructions, /Acceptance is impossible/);
  assert.match(out.instructions, /Fix the recorded failures/);

  const round = readRounds(rc)[0];
  assert.equal(round.status, 'rejected');
  assert.equal(round.mechanical_checks_passed, false);
  assert.equal('semantic_checks_passed' in round, false);
  assert.equal((round.failures as unknown[]).length > 0, true);
  assert.equal(artifactStatus(rc), 'rejected');
  assert.equal(readMeta(rc).latest_status, 'rejected');
});

// ---------------------------------------------------------------------------
// Any finding is a failure: minor-severity findings reject too
// ---------------------------------------------------------------------------

/** Introduces a minor-severity mechanical finding (sentence-count) on disk. */
function breakArtifactMinor(rc: ReadyChange): void {
  const artifactPath = path.join(rc.changeRoot, 'requirements.yaml');
  const artifact = readYaml(artifactPath) as Record<string, unknown> & {
    metadata: { status: string; request_summary?: string };
  };
  (artifact as { problem_statement?: string }).problem_statement =
    'One. Two. Three. Four. Five. Six. Seven. Eight.';
  artifact.metadata.status = 'ready-for-review';
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');
}

test('a minor-severity finding is a failure: bare invocation reports mechanical invalid and --accept forces rejection', () => {
  const rc = setupReadyChange('Add device registration');
  breakArtifactMinor(rc);

  // Bare invocation: the minor finding is listed as a failure, mechanical.valid false.
  let out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.data.status, 'open');
  assert.deepEqual(out.data.failures.map((f: { check: string }) => f.check), ['sentence-count']);
  assert.equal(out.warnings.length, 0);

  let round = readRounds(rc)[0];
  assert.equal(round.mechanical_checks_passed, false);
  assert.equal((round.failures as { check: string }[])[0].check, 'sentence-count');
  assert.equal('severity' in (round.failures as unknown[])[0], false);

  // --accept with a minor finding forces rejection exactly like a blocking one.
  out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept']);
  assert.equal(out.state, 'blocked');
  assert.equal(out.data.status, 'rejected');
  assert.equal(out.errors[0].code, 'REVIEW_NOT_PASSING');
  assert.equal(artifactStatus(rc), 'rejected');

  round = readRounds(rc)[0];
  assert.equal(round.status, 'rejected');
  assert.equal(round.mechanical_checks_passed, false);
});

// ---------------------------------------------------------------------------
// Refusals: nothing written
// ---------------------------------------------------------------------------

function assertNothingWritten(rc: ReadyChange, out: Record<string, unknown>): void {
  assert.equal(fs.existsSync(reviewFile(rc)), false, 'no review file written');
  assert.equal(artifactStatus(rc), 'ready-for-review', 'artifact untouched');
}

test('bare --reject with passing mechanicals is refused with nothing written', () => {
  const rc = setupReadyChange('Add device registration');

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--reject']);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
  assert.match(String(out.errors[0].message), /--reject requires --failures/);
  assertNothingWritten(rc, out);
});

test('--failures with --accept is refused with nothing written', () => {
  const rc = setupReadyChange('Add device registration');
  const file = writeFailuresFile(rc, 'failures.yaml', [semanticFailure(rc)]);

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--accept',
    '--failures',
    file,
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
  assertNothingWritten(rc, out);
});

test('--failures without --reject is refused with nothing written', () => {
  const rc = setupReadyChange('Add device registration');
  const file = writeFailuresFile(rc, 'failures.yaml', [semanticFailure(rc)]);

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--failures', file]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
  assertNothingWritten(rc, out);
});

test('--failures while mechanical checks fail is refused with nothing written', () => {
  const rc = setupReadyChange('Add device registration');
  breakArtifact(rc);
  const file = writeFailuresFile(rc, 'failures.yaml', [semanticFailure(rc)]);

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--failures',
    file,
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
  assert.match(String(out.errors[0].message), /mechanical failures are CLI-computed/);
  assertNothingWritten(rc, out);
});

test('a malformed --failures file refuses the invocation naming the entry with nothing written', () => {
  const rc = setupReadyChange('Add device registration');

  const cases: { name: string; body: string; code: string }[] = [
    { name: 'not-a-list.yaml', body: 'check: x\nevidence: y\n', code: 'FAILURE_ENTRY_INVALID' },
    { name: 'empty-list.yaml', body: '[]\n', code: 'FAILURE_ENTRY_INVALID' },
    { name: 'missing-evidence.yaml', body: '- check: "x"\n', code: 'FAILURE_ENTRY_INVALID' },
    {
      name: 'status-field.yaml',
      body: '- check: "x"\n  status: fail\n  evidence: "y"\n',
      code: 'FAILURE_ENTRY_INVALID',
    },
    {
      name: 'unknown-check.yaml',
      body: `- check: "Not a declared check"\n  evidence: "y"\n`,
      code: 'SEMANTIC_FAILURE_INVALID',
    },
  ];

  for (const c of cases) {
    const file = path.join(rc.tmp, c.name);
    fs.writeFileSync(file, c.body, 'utf8');
    const out = runCli(rc.tmp, [
      'requirements-review',
      '--change',
      rc.changeDir,
      '--reject',
      '--failures',
      file,
    ]);
    assert.equal(out.state, 'blocked', c.name);
    assert.equal(out.errors[0].code, c.code, c.name);
    assertNothingWritten(rc, out);
  }
});

test('a duplicate semantic failure entry is refused with nothing written', () => {
  const rc = setupReadyChange('Add device registration');
  const failure = semanticFailure(rc);
  const file = writeFailuresFile(rc, 'dup.yaml', [failure, failure]);

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--failures',
    file,
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'SEMANTIC_FAILURE_INVALID');
  assertNothingWritten(rc, out);
});

test('a tracked artifact already accepted refuses any invocation with nothing written', () => {
  const rc = setupReadyChange('Add device registration');
  runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept']);
  assert.equal(artifactStatus(rc), 'accepted');

  for (const extra of [[], ['--accept'], ['--reject']]) {
    const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, ...extra]);
    assert.equal(out.state, 'blocked');
    assert.equal(out.errors[0].code, 'STAGE_GATE_BLOCKED');
    assert.match(String(out.errors[0].message), /already accepted/);
    assert.match(out.instructions, /already accepted; re-review requires the author to update and re-finalize/);
  }

  // The accepted round store is untouched by the refused invocations.
  assert.equal(readRounds(rc).length, 1);
  assert.equal(readRounds(rc)[0].status, 'accepted');
});

test('a tracked artifact rejected is gate-blocked with required ready-for-review', () => {
  const rc = setupReadyChange('Add device registration');
  runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--failures',
    writeFailuresFile(rc, 'failures.yaml', [semanticFailure(rc)]),
  ]);
  assert.equal(artifactStatus(rc), 'rejected');

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'STAGE_GATE_BLOCKED');
  assert.equal(out.data.unsatisfied_requirements[0].required, 'ready-for-review');
  assert.equal(out.data.unsatisfied_requirements[0].status, 'rejected');
  // The refused invocation appends no round and leaves the artifact rejected.
  assert.equal(readRounds(rc).length, 1);
  assert.equal(artifactStatus(rc), 'rejected');
});

test('the removed --note flag is refused with a migration message and nothing written', () => {
  const rc = setupReadyChange('Add device registration');

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--note',
    'A note.',
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
  assert.match(String(out.errors[0].message), /--note was removed/);
  assertNothingWritten(rc, out);
});

test('the removed --findings flag is refused with a rename hint and nothing written', () => {
  const rc = setupReadyChange('Add device registration');
  const file = writeFailuresFile(rc, 'failures.yaml', [semanticFailure(rc)]);

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--findings',
    file,
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
  assert.match(String(out.errors[0].message), /--findings was renamed to --failures/);
  assertNothingWritten(rc, out);
});

test('--accept together with --reject is refused with nothing written', () => {
  const rc = setupReadyChange('Add device registration');

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--accept',
    '--reject',
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'CONFLICTING_DECISION');
  assertNothingWritten(rc, out);
});

// ---------------------------------------------------------------------------
// Envelope shape and instructions
// ---------------------------------------------------------------------------

test('the envelope keeps exactly the seven frozen top-level fields', () => {
  const rc = setupReadyChange('Add device registration');

  const bare = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.deepEqual(Object.keys(bare), ['workflow', 'step', 'state', 'instructions', 'data', 'errors', 'warnings']);

  const verdict = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept']);
  assert.deepEqual(Object.keys(verdict), ['workflow', 'step', 'state', 'instructions', 'data', 'errors', 'warnings']);
});

test('the review envelope data carries status and failures and no decision surface', () => {
  const rc = setupReadyChange('Add device registration');

  const bare = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal('decision' in bare.data, false);
  assert.equal('can_accept' in bare.data, false);
  assert.equal('blocking_count' in bare.data, false);
  assert.equal('blocking_findings' in bare.data, false);
  assert.equal(bare.data.status, 'open');
  assert.deepEqual(bare.data.failures, []);
});

test('bare-passing instructions list all semantic checks and the verdict guidance', () => {
  const rc = setupReadyChange('Add device registration');

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.match(out.instructions, /Review the semantic checklist/);
  assert.match(out.instructions, /--accept accepts the artifact/);
  assert.match(out.instructions, /--reject --failures <file>/);
  for (const check of REQUIREMENTS_CHECKS) {
    assert.ok(out.instructions.includes(check), `instructions list the check: ${check.slice(0, 40)}`);
  }
});

test('bare-with-failures instructions say mechanical checks failed and list the failures', () => {
  const rc = setupReadyChange('Add device registration');
  breakArtifact(rc);

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(out.state, 'blocked');
  assert.match(out.instructions, /Mechanical checks failed/);
  for (const failure of out.data.failures as { check: string; evidence: string }[]) {
    assert.ok(out.instructions.includes(failure.check));
    assert.ok(out.instructions.includes(failure.evidence));
  }
});

test('dry-run bare and verdict invocations write nothing while reporting the status that would be recorded', () => {
  const rc = setupReadyChange('Add device registration');

  // Dry-run bare: no round written.
  let out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--dry-run']);
  assert.equal(out.data.dry_run, true);
  assert.equal(out.data.round, null);
  assert.equal(out.data.status, 'open');
  assert.equal(fs.existsSync(reviewFile(rc)), false);

  // Dry-run forced rejection: no round, no artifact status change.
  breakArtifact(rc);
  out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept', '--dry-run']);
  assert.equal(out.data.dry_run, true);
  assert.equal(out.data.round, null);
  assert.equal(out.data.status, 'rejected');
  assert.equal(fs.existsSync(reviewFile(rc)), false);
  assert.equal(artifactStatus(rc), 'ready-for-review');

  // A later non-dry-run verdict still completes round 1: the dry runs wrote nothing.
  out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--reject']);
  assert.equal(out.data.round, 1);
  assert.equal(readRounds(rc).length, 1);
});

test('the --failures path resolves relative to the process working directory', () => {
  const rc = setupReadyChange('Add device registration');
  const failure = semanticFailure(rc);
  // Written into the CLI's cwd (rc.tmp) and referenced by bare relative path.
  fs.writeFileSync(
    path.join(rc.tmp, 'relative.yaml'),
    `  - check: ${JSON.stringify(failure.check)}\n    evidence: ${JSON.stringify(failure.evidence)}\n`,
    'utf8'
  );

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--failures',
    'relative.yaml',
  ]);
  assert.equal(out.data.status, 'rejected');
  assert.deepEqual((readRounds(rc)[0].failures as unknown[])[0], failure);
});
