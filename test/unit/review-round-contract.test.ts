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
// semantic walk universe for requirements-review verdicts.
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

function artifactStatus(rc: ReadyChange): string {
  const artifact = readYaml(path.join(rc.changeRoot, 'requirements.yaml')) as {
    metadata: { status: string };
  };
  return artifact.metadata.status;
}

/**
 * Writes a findings file with a complete all-pass semantic walk (one item per
 * check of the requirements stage's semantic-checks.yaml) plus optional
 * extra findings entries. Returns the ABSOLUTE path; callers pass it as-is
 * (assumption 5: the --findings value resolves relative to the process
 * working directory, and the CLI runs with cwd = tmp).
 */
function writeWalkFile(
  rc: ReadyChange,
  name: string,
  opts: { statuses?: string[]; omitLast?: boolean; findings?: string } = {}
): string {
  const checks = opts.omitLast ? REQUIREMENTS_CHECKS.slice(0, -1) : REQUIREMENTS_CHECKS;
  const statuses = opts.statuses || checks.map(() => 'pass');
  const items = checks
    .map((c, i) => `  - check_id: ${JSON.stringify(c)}\n    status: ${statuses[i]}\n    evidence: "Verified in session."\n`)
    .join('');
  const doc = `semantic:\n${items}${opts.findings ? `findings:\n${opts.findings}` : ''}`;
  const file = path.join(rc.tmp, name);
  fs.writeFileSync(file, doc, 'utf8');
  return file;
}

/** Introduces a blocking mechanical finding by duplicating an AC id on disk. */
function breakArtifact(rc: ReadyChange): void {
  const artifactPath = path.join(rc.changeRoot, 'requirements.yaml');
  const artifact = readYaml(artifactPath) as Record<string, unknown> & {
    acceptance_criteria: Record<string, unknown>[];
    metadata: { status: string };
  };
  artifact.acceptance_criteria.push({ ...artifact.acceptance_criteria[0] });
  artifact.metadata.status = 'ready-for-review';
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');
}

test('bare invocation opens a round with status open, decision review, and a mechanical block (AC-001)', () => {
  const rc = setupReadyChange('Add device registration');

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(out.state, 'ok');
  assert.equal(out.data.round, 1);
  assert.equal(out.data.decision, 'review');

  const rounds = readRounds(rc);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].round, 1);
  assert.equal(rounds[0].status, 'open');
  assert.equal(rounds[0].decision, 'review');
  assert.ok(rounds[0].mechanical && typeof rounds[0].mechanical === 'object');
  assert.equal((rounds[0].mechanical as Record<string, unknown>).valid, true);
});

test('a second bare invocation refreshes the open round in place keeping the same round number (AC-003, assumption 6)', () => {
  const rc = setupReadyChange('Add device registration');

  runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.equal(out.data.round, 1);

  const rounds = readRounds(rc);
  // Round numbering increments only when a round is appended, never on refresh.
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].round, 1);
  assert.equal(rounds[0].status, 'open');
  assert.equal(rounds[0].decision, 'review');
});

test('a verdict completes the latest open round in place with no additional round (AC-004)', () => {
  const rc = setupReadyChange('Add device registration');

  runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--note',
    'The failure paths are not specified.',
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.data.round, 1);
  assert.equal(artifactStatus(rc), 'rejected');

  const rounds = readRounds(rc);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].round, 1);
  assert.equal(rounds[0].decision, 'rejected');
  assert.equal(rounds[0].status, 'closed');
  assert.equal(rounds[0].rationale, 'The failure paths are not specified.');
});

test('a verdict with no open round appends a complete closed round (AC-006)', () => {
  const rc = setupReadyChange('Add device registration');

  // Verdict without a prior bare invocation: no open round exists.
  let out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--note',
    'Needs a narrower scope.',
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

  const walk = writeWalkFile(rc, 'walk.yaml');
  out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--accept',
    '--findings',
    walk,
  ]);
  assert.equal(out.state, 'complete');

  const rounds = readRounds(rc);
  assert.deepEqual(rounds.map((r) => r.decision), ['rejected', 'accepted']);
  assert.deepEqual(rounds.map((r) => r.status), ['closed', 'closed']);
  assert.deepEqual(rounds.map((r) => r.round), [1, 2]);
});

test('legacy rounds without a status field are treated as closed and left unmodified (AC-007)', () => {
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
  // The open-to-closed logic applies only to the newly written round.
  assert.equal(rounds[1].status, 'open');
});

test('--note and --findings are mutually exclusive and write nothing (AC-010)', () => {
  const rc = setupReadyChange('Add device registration');
  const walk = writeWalkFile(rc, 'walk.yaml');

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--note',
    'A note.',
    '--findings',
    walk,
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
  assert.equal(fs.existsSync(reviewFile(rc)), false);
  assert.equal(artifactStatus(rc), 'ready-for-review');
});

test('--note or --findings without a verdict flag is a usage error writing nothing (AC-011)', () => {
  const rc = setupReadyChange('Add device registration');
  const walk = writeWalkFile(rc, 'walk.yaml');

  for (const flag of ['--note', '--findings']) {
    const args = flag === '--note' ? [flag, 'A note.'] : [flag, walk];
    const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, ...args]);
    assert.equal(out.state, 'blocked', flag);
    assert.equal(out.errors[0].code, 'USAGE', flag);
    assert.equal(fs.existsSync(reviewFile(rc)), false, flag);
  }
  assert.equal(artifactStatus(rc), 'ready-for-review');
});

test('--reject with passing mechanical checks requires --note or --findings (AC-009)', () => {
  const rc = setupReadyChange('Add device registration');

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--reject']);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
  assert.equal(fs.existsSync(reviewFile(rc)), false);
  assert.equal(artifactStatus(rc), 'ready-for-review');
});

test('--reject with blocking mechanical findings proceeds without reviewer input (AC-008)', () => {
  const rc = setupReadyChange('Add device registration');
  breakArtifact(rc);

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--reject']);
  assert.equal(out.data.artifact_status, 'rejected');

  const rounds = readRounds(rc);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].decision, 'rejected');
  assert.equal(rounds[0].status, 'closed');
  // The mechanical findings are the rationale (DEC-004 fallback).
  assert.match(String(rounds[0].rationale), /blocking mechanical finding/);
});

test('a findings entry missing its required field refuses naming the entry with nothing written (AC-012)', () => {
  const rc = setupReadyChange('Add device registration');
  const bad = path.join(rc.tmp, 'bad.yaml');
  fs.writeFileSync(bad, 'findings:\n  - target: REQ-001\n', 'utf8');

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--findings',
    bad,
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'FINDINGS_ENTRY_INVALID');
  assert.match(String(out.errors[0].message), /entry 0/);
  assert.equal(fs.existsSync(reviewFile(rc)), false);
  assert.equal(artifactStatus(rc), 'ready-for-review');
});

test('recorded reviewer findings never carry a severity field (AC-014, AC-015)', () => {
  const rc = setupReadyChange('Add device registration');
  const findings = [
    '  - target: REQ-001',
    '    finding: "Advisory observation."',
    '    severity: blocking',
    '',
  ].join('\n');
  const walk = writeWalkFile(rc, 'walk.yaml', { findings });

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--accept',
    '--findings',
    walk,
  ]);
  assert.equal(out.state, 'complete');

  const rounds = readRounds(rc);
  const recorded = rounds[0].findings as Record<string, unknown>[];
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].target, 'REQ-001');
  assert.equal(recorded[0].finding, 'Advisory observation.');
  assert.equal('severity' in recorded[0], false);
});

test('an unknown id-shaped target warns while the round is still recorded (AC-013)', () => {
  const rc = setupReadyChange('Add device registration');
  const findings = [
    '  - target: FR-999',
    '    finding: "Unknown id target."',
    '  - target: "Free text: the login section"',
    '    finding: "Free text anchor."',
    '',
  ].join('\n');
  const walk = writeWalkFile(rc, 'walk.yaml', { findings });

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--findings',
    walk,
  ]);
  const warning = out.warnings.find((w: { code: string }) => w.code === 'UNKNOWN_FINDING_TARGET');
  assert.ok(warning, 'envelope warning expected');
  assert.match(String(warning.message), /FR-999/);
  assert.equal(out.data.round, 1);
  assert.equal(readRounds(rc).length, 1);

  const round = readRounds(rc)[0];
  const roundWarnings = round.warnings as { code: string }[];
  assert.ok(roundWarnings.some((w) => w.code === 'UNKNOWN_FINDING_TARGET'));
});

test('test note (follow-up note 5): the DM-004 id pattern excludes single-letter-prefixed ids such as F-001, so such targets are free text and never warn', () => {
  const rc = setupReadyChange('Add device registration');
  const findings = [
    '  - target: F-001',
    '    finding: "Single-letter-prefixed id target."',
    '',
  ].join('\n');
  const walk = writeWalkFile(rc, 'walk.yaml', { findings });

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--findings',
    walk,
  ]);
  // Documented blind spot (design-review round-2 follow-up note 5): pinned as
  // asserted behavior; widening the pattern is a design-review event.
  assert.equal(out.warnings.filter((w: { code: string }) => w.code === 'UNKNOWN_FINDING_TARGET').length, 0);
  assert.equal(readRounds(rc).length, 1);
});

test('a complete all-pass walk is accepted and the semantic block is recorded (AC-016)', () => {
  const rc = setupReadyChange('Add device registration');
  const walk = writeWalkFile(rc, 'walk.yaml');

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--accept',
    '--findings',
    walk,
  ]);
  assert.equal(out.state, 'complete');
  assert.equal(out.data.artifact_status, 'accepted');

  const round = readRounds(rc)[0];
  assert.equal(round.decision, 'accepted');
  assert.equal(round.status, 'closed');
  const semantic = round.semantic as { results: Record<string, unknown>[] };
  assert.equal(semantic.results.length, REQUIREMENTS_CHECKS.length);
  for (const result of semantic.results) {
    assert.equal(result.status, 'pass');
    assert.ok(String(result.evidence).length > 0);
  }
});

test('an incomplete or failing walk refuses acceptance with nothing written (AC-017)', () => {
  const rc = setupReadyChange('Add device registration');

  const incomplete = writeWalkFile(rc, 'incomplete.yaml', { omitLast: true });
  let out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--accept',
    '--findings',
    incomplete,
  ]);
  assert.equal(out.errors[0].code, 'SEMANTIC_WALK_INVALID');
  assert.equal(fs.existsSync(reviewFile(rc)), false);
  assert.equal(artifactStatus(rc), 'ready-for-review');

  const failing = writeWalkFile(rc, 'failing.yaml', { statuses: REQUIREMENTS_CHECKS.map((_, i) => (i === 0 ? 'fail' : 'pass')) });
  out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--accept',
    '--findings',
    failing,
  ]);
  assert.equal(out.errors[0].code, 'SEMANTIC_WALK_INVALID');
  assert.equal(fs.existsSync(reviewFile(rc)), false);
  assert.equal(artifactStatus(rc), 'ready-for-review');

  // A missing walk is refused too.
  out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--accept']);
  assert.equal(out.errors[0].code, 'SEMANTIC_WALK_INVALID');
  assert.equal(fs.existsSync(reviewFile(rc)), false);
});

test('rounds completed with mechanical blocking findings carry no semantic block (AC-018)', () => {
  const rc = setupReadyChange('Add device registration');
  breakArtifact(rc);
  const walk = writeWalkFile(rc, 'walk.yaml');

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--findings',
    walk,
  ]);
  assert.equal(out.data.artifact_status, 'rejected');

  const round = readRounds(rc)[0];
  assert.equal(round.decision, 'rejected');
  assert.equal(round.semantic, undefined);
});

test('accept_blocked completes the round with the explicit token, leaves the artifact untouched, and reports CANNOT_ACCEPT (DEC-002)', () => {
  const rc = setupReadyChange('Add device registration');
  runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  breakArtifact(rc);

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--accept',
    '--note',
    'Reviewer observed the duplicate id.',
  ]);
  assert.equal(out.state, 'blocked');
  assert.equal(out.data.decision, 'accept_blocked');
  assert.equal(out.errors[0].code, 'CANNOT_ACCEPT');
  assert.equal(artifactStatus(rc), 'ready-for-review');

  const rounds = readRounds(rc);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].decision, 'accept_blocked');
  assert.equal(rounds[0].status, 'closed');
  // DEC-004 on the blocked path (follow-up note 2): the note is the rationale.
  assert.equal(rounds[0].rationale, 'Reviewer observed the duplicate id.');
  assert.equal(rounds[0].semantic, undefined);
});

test('the envelope keeps exactly the seven frozen top-level fields (AC-020)', () => {
  const rc = setupReadyChange('Add device registration');

  const bare = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.deepEqual(Object.keys(bare), ['workflow', 'step', 'state', 'instructions', 'data', 'errors', 'warnings']);

  const walk = writeWalkFile(rc, 'walk.yaml');
  const verdict = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--accept',
    '--findings',
    walk,
  ]);
  assert.deepEqual(Object.keys(verdict), ['workflow', 'step', 'state', 'instructions', 'data', 'errors', 'warnings']);
});

test('bare instructions name the semantic walk requirement and the rejection input requirement (AC-019)', () => {
  const rc = setupReadyChange('Add device registration');

  const out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir]);
  assert.match(out.instructions, /Acceptance requires the complete semantic walk/);
  assert.match(out.instructions, /Rejection requires --note or --findings/);
  for (const check of REQUIREMENTS_CHECKS) {
    assert.ok(out.instructions.includes(check), `instructions list the check: ${check.slice(0, 40)}`);
  }
});

test('dry-run bare and verdict invocations write nothing while reporting the decision that would be recorded (AC-002)', () => {
  const rc = setupReadyChange('Add device registration');

  // Dry-run bare: no round written.
  let out = runCli(rc.tmp, ['requirements-review', '--change', rc.changeDir, '--dry-run']);
  assert.equal(out.data.dry_run, true);
  assert.equal(out.data.round, null);
  assert.equal(out.data.decision, 'review');
  assert.equal(fs.existsSync(reviewFile(rc)), false);

  // Dry-run verdict: no round, no artifact status change, decision reported.
  out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--note',
    'Dry-run rejection.',
    '--dry-run',
  ]);
  assert.equal(out.data.dry_run, true);
  assert.equal(out.data.round, null);
  assert.equal(out.data.decision, 'rejected');
  assert.equal(fs.existsSync(reviewFile(rc)), false);
  assert.equal(artifactStatus(rc), 'ready-for-review');

  // A later non-dry-run verdict still completes round 1: the dry runs wrote nothing.
  out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--note',
    'Real rejection.',
  ]);
  assert.equal(out.data.round, 1);
  assert.equal(readRounds(rc).length, 1);
});

test('the --findings path resolves relative to the process working directory (assumption 5)', () => {
  const rc = setupReadyChange('Add device registration');
  const findings = ['  - target: REQ-001', '    finding: "Cwd-relative file."', ''].join('\n');
  // Written into the CLI's cwd (rc.tmp) and referenced by bare relative path:
  // the CLI process runs with cwd rc.tmp, so the raw argv path resolves there.
  fs.writeFileSync(path.join(rc.tmp, 'relative.yaml'), `findings:\n${findings}`, 'utf8');

  const out = runCli(rc.tmp, [
    'requirements-review',
    '--change',
    rc.changeDir,
    '--reject',
    '--findings',
    'relative.yaml',
  ]);
  assert.equal(out.data.round, 1);
  const round = readRounds(rc)[0];
  assert.equal((round.findings as Record<string, unknown>[])[0].finding, 'Cwd-relative file.');
});
