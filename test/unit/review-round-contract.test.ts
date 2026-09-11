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
    path.join(tmp, 'docs', 'current', 'architecture.md'),
    '# architecture.md\n',
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
  const changeDir = request
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  assert.equal(runCli(tmp, ['init', '--change', changeDir]).state, 'ok');
  let out = runCli(tmp, ['requirements', '--change', changeDir]);
  const changeRoot = String(out.data.change_root);
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
// Any finding is a failure: a single mechanical finding rejects too
// ---------------------------------------------------------------------------

/** Introduces a one-finding mechanical failure (forbidden word) on disk. */
function breakArtifactSingle(rc: ReadyChange): void {
  const artifactPath = path.join(rc.changeRoot, 'requirements.yaml');
  const artifact = readYaml(artifactPath) as Record<string, unknown> & {
    metadata: { status: string; request_summary?: string };
  };
  (artifact as { problem_statement?: string }).problem_statement =
    'The registration flow is simple and covers every operator need.';
  artifact.metadata.status = 'ready-for-review';
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');
}

test('a single mechanical finding is a failure: bare invocation reports mechanical invalid and --accept forces rejection', () => {
  const rc = setupReadyChange('Add device registration');
  breakArtifactSingle(rc);

  // Bare invocation: the finding is listed as a failure, mechanical.valid false.
  let out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.data.status, 'open');
  assert.deepEqual(out.data.failures.map((f: { check: string }) => f.check), ['forbidden-word']);
  assert.equal(out.warnings.length, 0);

  let round = readRounds(rc)[0];
  assert.equal(round.mechanical_checks_passed, false);
  assert.equal((round.failures as { check: string }[])[0].check, 'forbidden-word');
  assert.equal('severity' in (round.failures as unknown[])[0], false);

  // --accept with one finding forces rejection exactly like many.
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

test('an unknown check name is refused with the full submitted value, the verbatim rule, and the listing path', () => {
  const rc = setupReadyChange('Add device registration');
  // The numbered pseudo-name that triggered the original failure: longer than
  // the old 80-char truncation window, so a re-truncation fails this test.
  const submitted = `${REQUIREMENTS_CHECKS[0].slice(0, 60)} ... (paraphrased tail padded to exceed eighty characters in total length)`;
  const file = writeFailuresFile(rc, 'unknown.yaml', [{ check: submitted, evidence: 'y' }]);

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
  const message = String(out.errors[0].message);
  assert.ok(message.includes(submitted), 'refusal carries the full submitted value');
  assert.match(message, /Copy the declared check text verbatim — numbers are not names/);
  assert.match(message, /--list-semantic-checks/);
  // The refusal envelope carries the declared checks: the retry needs no
  // extra listing call.
  assert.deepEqual(out.data.semantic_checks, REQUIREMENTS_CHECKS);
  assertNothingWritten(rc, out);
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
  // The refusal carries the FULL untruncated check text and the merge rule,
  // so the reviewer can fix the file without re-deriving the rule.
  const message = String(out.errors[0].message);
  assert.ok(message.includes(failure.check), 'refusal names the full check text');
  assert.match(message, /One entry per failed check: merge all findings of that check into the single entry's evidence/);
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

test('the removed --note flag is refused by the closed vocabulary and nothing written', () => {
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
  assert.equal(out.errors[0].code, 'UNKNOWN_FLAG');
  assert.deepEqual(out.data.unknown_flags, ['--note']);
  assertNothingWritten(rc, out);
});

test('the removed --findings flag is refused by the closed vocabulary and nothing written', () => {
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
  assert.equal(out.errors[0].code, 'UNKNOWN_FLAG');
  assert.deepEqual(out.data.unknown_flags, ['--findings']);
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
  assert.deepEqual(Object.keys(bare), ['command', 'step', 'state', 'instructions', 'data', 'errors', 'warnings']);

  const verdict = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept']);
  assert.deepEqual(Object.keys(verdict), ['command', 'step', 'state', 'instructions', 'data', 'errors', 'warnings']);
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

test('bare-review envelope carries the declared checks and the naming rules; verdict envelopes stay lean', () => {
  const rc = setupReadyChange('Add device registration');

  const bare = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  // Structured checklist: copying a check name into a --failures entry must
  // be mechanical, not re-typed from prose.
  assert.deepEqual(bare.data.semantic_checks, REQUIREMENTS_CHECKS);
  assert.match(bare.instructions, /The numbers above are list positions, not names/);
  assert.match(bare.instructions, /copied verbatim/);
  assert.match(bare.instructions, /record at most one entry per failed check/);

  const accept = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept']);
  assert.equal('semantic_checks' in accept.data, false);
});

test('--list-semantic-checks prints the declared checks and writes nothing', () => {
  const rc = setupReadyChange('Add device registration');
  runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(readRounds(rc).length, 1);

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--list-semantic-checks',
  ]);
  assert.equal(out.state, 'ok');
  assert.equal(out.step, 'list_checks');
  assert.deepEqual(out.data.semantic_checks, REQUIREMENTS_CHECKS);
  // No round opened, refreshed, or written: the open round is untouched.
  assert.equal(out.data.round, undefined);
  assert.equal(readRounds(rc).length, 1);
  assert.equal(readRounds(rc)[0].status, 'open');
});

test('--list-semantic-checks still requires a resolvable change and writes nothing', () => {
  const tmp = makeProject();

  const noChange = runCli(tmp, ['requirements-review', '--list-semantic-checks']);
  assert.equal(noChange.state, 'blocked');
  assert.equal(noChange.errors[0].code, 'MISSING_CHANGE_DIR');

  const unknown = runCli(tmp, ['requirements-review', '--change', 'no-such-change', '--list-semantic-checks']);
  assert.equal(unknown.state, 'blocked');
  assert.equal(unknown.errors[0].code, 'CHANGE_DIR_NOT_FOUND');
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

// ---------------------------------------------------------------------------
// Steps-contract lint: the naming and merge rules must survive future
// steps.yaml rewrites in all four review stages.
// ---------------------------------------------------------------------------

test('every review stage keeps the verbatim-name and merge rules in review and reject steps', () => {
  for (const stageId of [
    'requirements-review',
    'design-review',
    'planning-review',
    'implementation-review',
  ]) {
    const stepsPath = path.join(root, 'src', 'stages', stageId, 'steps.yaml');
    const steps = readYaml(stepsPath) as {
      steps: Record<string, { markdown?: string }>;
    };

    const review = steps.steps.review?.markdown || '';
    assert.match(review, /checklist numbers are list positions, not names/, stageId);
    assert.match(review, /full question text copied verbatim/, stageId);
    assert.match(review, /A mechanical failure line looks like/, stageId);

    const reject = steps.steps.reject?.markdown || '';
    assert.match(reject, /quote the checklist question verbatim/, stageId);
    assert.match(reject, /One entry per failed check: merge all findings of that check into the single entry's evidence/, stageId);
    assert.match(reject, /a duplicate entry for a check is refused/, stageId);
  }
});
