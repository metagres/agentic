import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// CMP-002: mechanical regression guard for the delegation stem in
// mine_transcript.ts (FR-001, FR-002). The suite spawns the miner with
// process.execPath via spawnSync from the repo root and asserts report rows
// and exit codes on the unchanged CLI surface (API-001).
//
// AC-007 (by construction): the committed fixture's delegation-phrased line is
// spelled "delegation", which the pre-fix stem /\bdelegate(?:d|s|ion)?\b/i can
// never match — the stem demands the literal prefix "delegate", and
// "delegation" spells "delegat" + "ion". The delegations=1 assertions below
// therefore fail under the pre-fix stem and pass under the fixed stem
// /\bdelegat(?:e|ed|es|ion)\b/i, so a stem unable to match "delegation" fails
// mechanically on every validate run. Per DEC-001 this regression property is
// recorded as reasoning here, never as a two-version byte diff.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const minerPath = path.join(
  root,
  'src',
  'skills',
  'improvement-review',
  'scripts',
  'mine_transcript.ts'
);
const fixturePath = path.join(
  root,
  'test',
  'fixtures',
  'mine-transcript',
  'delegation-transcript.txt'
);

interface MinerRun {
  stdout: string;
  stderr: string;
  status: number | null;
}

function runMiner(args: string[]): MinerRun {
  const res = spawnSync(process.execPath, [minerPath, ...args], {
    encoding: 'utf8',
    cwd: root,
  });
  assert.ok(
    res.stdout,
    `no stdout from the miner (${args.join(' ')}):\n${res.stderr}`
  );
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

/** Reads the numeric value of a default-report row by its exact label. */
function rowValue(stdout: string, label: string): number {
  const match = stdout.match(new RegExp(`^label=${label} value=(\\d+)`, 'm'));
  assert.ok(match, `expected a row label=${label} in output:\n${stdout}`);
  return Number(match[1]);
}

/**
 * Asserts a verbose row whose emitted line starts with the given
 * basename-prefixed label prefix and carries the expected value — a prefix
 * match on the emitted format, never a whole-line byte comparison (the lines
 * continue with value=/unit=/source= suffixes).
 */
function assertVerboseRow(stdout: string, prefix: string, value: number): void {
  const line = stdout.split('\n').find((candidate) => candidate.startsWith(prefix));
  assert.ok(line, `expected a row starting with ${prefix} in output:\n${stdout}`);
  assert.match(
    line.slice(prefix.length),
    new RegExp(`^ value=${value}\\b`),
    `row ${prefix} should carry value=${value}`
  );
}

function assertResultOk(stdout: string): void {
  assert.match(stdout, /^result: ok$/m, `expected result: ok in output:\n${stdout}`);
}

function assertZeroExtractionReport(stdout: string, file: string): void {
  const reportIndex = stdout.indexOf('zero_extraction_report:');
  assert.ok(reportIndex !== -1, `expected a zero_extraction_report in output:\n${stdout}`);
  assert.ok(
    stdout.slice(reportIndex).includes(file),
    `zero_extraction_report should name ${file}:\n${stdout}`
  );
}

/** Writes a per-case transcript into a temp dir and removes it afterwards. */
function withTempTranscript(lines: string[], run: (file: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-mine-'));
  try {
    const file = path.join(dir, 'transcript.txt');
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Committed fixture (CMP-003, DEC-002): one clean sdlc invocation line and one
// delegation-phrased event line.
// ---------------------------------------------------------------------------

test('the committed fixture yields one invocation and one delegation with default output (AC-006)', () => {
  assert.ok(fs.existsSync(fixturePath), `fixture missing: ${fixturePath}`);

  const run = runMiner([fixturePath]);

  assertResultOk(run.stdout);
  assert.equal(rowValue(run.stdout, 'invocations'), 1);
  assert.equal(rowValue(run.stdout, 'delegations'), 1);
  assert.equal(run.status, 0);
});

test('verbose output carries the basename-prefixed sub-field labels for the fixture event (AC-001)', () => {
  assert.ok(fs.existsSync(fixturePath), `fixture missing: ${fixturePath}`);

  const run = runMiner([fixturePath, '--verbose']);

  // DEC-003: sub-fields appear only under --verbose, prefixed with the file
  // basename per the miner's verbose row format (never bare label pairs).
  assertVerboseRow(run.stdout, 'label=delegation-transcript.txt:delegation_type:subagent', 1);
  assertVerboseRow(run.stdout, 'label=delegation-transcript.txt:delegation_model:resolved', 1);
  assertVerboseRow(run.stdout, 'label=delegation-transcript.txt:delegation_rework:none', 1);
  assert.equal(rowValue(run.stdout, 'delegations'), 1);
});

// ---------------------------------------------------------------------------
// Per-case temp transcripts (DEC-002): each acceptance scenario's input lives
// next to its assertion and is removed after the run.
// ---------------------------------------------------------------------------

test('delegated and delegates lines are each counted (AC-002)', () => {
  withTempTranscript(['delegated type=x rework=y', 'delegates type=z model=w'], (file) => {
    const run = runMiner([file]);

    assert.equal(rowValue(run.stdout, 'delegations'), 2);
  });
});

test('a delegating line is not counted and yields the zero-extraction report with a non-zero exit (AC-003, AC-009)', () => {
  withTempTranscript(['delegating type=a rework=b'], (file) => {
    const run = runMiner([file]);

    // "delegating" matches neither the pre-fix nor the fixed stem, so this
    // behavior is identical pre/post fix (AC-009 premise).
    assert.equal(rowValue(run.stdout, 'delegations'), 0);
    assert.equal(rowValue(run.stdout, 'invocations'), 0);
    assertZeroExtractionReport(run.stdout, file);
    assert.equal(run.status, 1);
  });
});

test('a delegation mention without a sub-field token is not counted (AC-004)', () => {
  withTempTranscript(
    [
      'node src/scripts/sdlc.ts requirements --change demo',
      'discussed the delegation report for the change',
    ],
    (file) => {
      const run = runMiner([file]);

      assert.equal(rowValue(run.stdout, 'delegations'), 0);
      assert.equal(rowValue(run.stdout, 'invocations'), 1);
    }
  );
});

test('delegation at line start and after a backtick is counted when a sub-field token is present (AC-005)', () => {
  withTempTranscript(
    [
      'delegation type=start model=m1 rework=r1',
      'checked `delegation` type=quoted model=m2 rework=r2',
    ],
    (file) => {
      const run = runMiner([file]);

      // The word boundary holds at line start and at the non-word backtick.
      assert.equal(rowValue(run.stdout, 'delegations'), 2);
    }
  );
});

test('a transcript with no stem-matching word keeps the ok result, zero delegations, and exit 0 (AC-008)', () => {
  withTempTranscript(
    [
      'node src/scripts/sdlc.ts design --change demo',
      'reviewed the plan and approved it',
    ],
    (file) => {
      const run = runMiner([file]);

      // NFR-001 observable class: no word in the transcript matches either
      // stem, so the delegation branch is inert; asserted as behavior, never
      // as a cross-version byte comparison (DEC-001).
      assertResultOk(run.stdout);
      assert.equal(rowValue(run.stdout, 'delegations'), 0);
      assert.equal(rowValue(run.stdout, 'invocations'), 1);
      assert.equal(run.status, 0);
    }
  );
});

test('the delegateion form is not counted, pinning the four-form stem scope (DEC-001 boundary)', () => {
  withTempTranscript(['delegateion type=x rework=y'], (file) => {
    const run = runMiner([file]);

    // The pre-fix stem over-matched "delegateion" (delegate + ion); the fixed
    // four-form stem must not. Zero invocations and zero delegations make
    // this a zero-extraction file, so exit 1 and the report follow as a side
    // effect of the unchanged exit contract.
    assert.equal(rowValue(run.stdout, 'delegations'), 0);
    assertZeroExtractionReport(run.stdout, file);
    assert.equal(run.status, 1);
  });
});
