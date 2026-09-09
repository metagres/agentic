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

// ---------------------------------------------------------------------------
// Failure events (envelope error signature): raw and escaped-JSON forms are
// counted per code; source-reading shapes (errors.yaml keys, makeError calls)
// never match.
// ---------------------------------------------------------------------------

test('an escaped-JSON envelope error signature is counted as a failure event', () => {
  // The session-embedded form: a tool result string inside a JSON transcript
  // carries escaped quotes around the envelope's code field.
  withTempTranscript(
    [
      'node src/scripts/sdlc.ts requirements --change demo',
      'tool result: \\n  \\\"state\\\": \\\"blocked\\\", \\n  \\\"errors\\\": [ { \\\"code\\\": \\\"CHANGE_DIR_NOT_FOUND\\\" } ]',
    ],
    (file) => {
      const run = runMiner([file]);

      assertResultOk(run.stdout);
      assert.equal(rowValue(run.stdout, 'invocations'), 1);
      assert.equal(rowValue(run.stdout, 'failures'), 1);
      assert.equal(run.status, 0);
    }
  );
});

test('a raw-JSON envelope error signature is counted as a failure event', () => {
  withTempTranscript(
    [
      'node src/scripts/sdlc.ts design --change demo',
      '{"state": "blocked", "errors": [{"code": "STAGE_GATE_BLOCKED"}]}',
    ],
    (file) => {
      const run = runMiner([file, '--verbose']);

      assert.equal(rowValue(run.stdout, 'failures'), 1);
      assertVerboseRow(run.stdout, 'label=transcript.txt:failure_code:STAGE_GATE_BLOCKED', 1);
    }
  );
});

test('source-reading shapes never match the failure signature', () => {
  withTempTranscript(
    [
      'node src/scripts/sdlc.ts status --change demo',
      'CHANGE_DIR_NOT_FOUND:',
      'message: No matching change was found.',
      "errors: [makeError('STAGE_GATE_BLOCKED', { message: 'not ready' })]",
    ],
    (file) => {
      const run = runMiner([file]);

      // errors.yaml keys (CODE:) and engine makeError('CODE') calls are source
      // text, not emitted envelopes — the signature must stay silent on them.
      assert.equal(rowValue(run.stdout, 'invocations'), 1);
      assert.equal(rowValue(run.stdout, 'failures'), 0);
      assert.equal(run.status, 0);
    }
  );
});

test('a failure-only transcript counts as event-ful (no zero-extraction report)', () => {
  withTempTranscript(['{"errors": [{"code": "MISSING_CHANGE_DIR"}]}'], (file) => {
    const run = runMiner([file]);

    assertResultOk(run.stdout);
    assert.equal(rowValue(run.stdout, 'invocations'), 0);
    assert.equal(rowValue(run.stdout, 'failures'), 1);
    assert.equal(run.status, 0);
  });
});

test('envelope warning codes are not failures (errors-array window only)', () => {
  withTempTranscript(
    [
      'node src/scripts/sdlc.ts design --change demo',
      '{"data": {}, "errors": [], "warnings": [{"code": "ARTIFACT_INITIALIZED", "message": "Created design.yaml"}]}',
    ],
    (file) => {
      const run = runMiner([file]);

      // ARTIFACT_INITIALIZED rides the warnings array — informational, never
      // a failure. The errors anchor opens the window; the warnings anchor
      // closes it before the code is reached.
      assert.equal(rowValue(run.stdout, 'invocations'), 1);
      assert.equal(rowValue(run.stdout, 'failures'), 0);
      assert.equal(run.status, 0);
    }
  );
});

// ---------------------------------------------------------------------------
// Event-class fixture (grammar extensions): failed tool calls, ack repeats,
// and a diagnosis loop — one committed fixture with expected counts, plus
// per-rule temp-transcript cases next to their assertions.
// ---------------------------------------------------------------------------

const eventClassesFixturePath = path.join(
  root,
  'test',
  'fixtures',
  'transcripts',
  'event-classes.txt'
);
const zeroExtractionFixturePath = path.join(
  root,
  'test',
  'fixtures',
  'transcripts',
  'zero-extraction.txt'
);

test('the event-classes fixture yields the expected counts for all three new detection rules', () => {
  assert.ok(fs.existsSync(eventClassesFixturePath), `fixture missing: ${eventClassesFixturePath}`);

  const run = runMiner([eventClassesFixturePath]);

  assertResultOk(run.stdout);
  // 3 sdlc invocations whose command lines differ (two --record-answer calls
  // with different answers) — no wasted-round candidates.
  assert.equal(rowValue(run.stdout, 'invocations'), 3);
  assert.equal(rowValue(run.stdout, 'wasted_round_candidates'), 0);
  // Invocations 2 and 3 return an instructions text identical to the
  // previous attributed slice — two repeats beyond the first.
  assert.equal(rowValue(run.stdout, 'ack_repeat_candidates'), 2);
  // One schema-error line and one exact-match edit-failure line.
  assert.equal(rowValue(run.stdout, 'tool_failures'), 2);
  // The edit failure arms the diagnosis-loop detector; the trailing
  // codegraph explore (no invocation in between) is one loop candidate.
  assert.equal(rowValue(run.stdout, 'explorations'), 1);
  assert.equal(rowValue(run.stdout, 'diagnosis_loop_candidates'), 1);
  assert.equal(rowValue(run.stdout, 'failures'), 0);
  assert.equal(rowValue(run.stdout, 'delegations'), 0);
  assert.equal(run.status, 0);
});

test('the event-classes fixture verbose rows carry the per-signature, per-kind, and per-run labels', () => {
  const run = runMiner([eventClassesFixturePath, '--verbose']);

  assertVerboseRow(run.stdout, 'label=event-classes.txt:tool_failure:edit-not-found', 1);
  assertVerboseRow(run.stdout, 'label=event-classes.txt:tool_failure:tool-schema-error', 1);
  assertVerboseRow(run.stdout, 'label=event-classes.txt:exploration:codegraph', 1);
  assertVerboseRow(run.stdout, 'label=event-classes.txt:diagnosis_loop_run', 1);
});

test('the zero-extraction fixture yields the explicit zero report and a non-zero exit (AC-006)', () => {
  assert.ok(
    fs.existsSync(zeroExtractionFixturePath),
    `fixture missing: ${zeroExtractionFixturePath}`
  );

  const run = runMiner([zeroExtractionFixturePath]);

  assert.match(run.stdout, /^result: zero-extraction$/m);
  assertZeroExtractionReport(run.stdout, zeroExtractionFixturePath);
  assert.equal(run.status, 1);
});

test('duplicate envelope copies for one invocation never count as ack repeats', () => {
  const ack =
    '{"step": "discovery", "instructions": "Interview the stakeholder.", "data": {}}';
  withTempTranscript(
    [
      'node src/scripts/sdlc.ts requirements --change demo --record-answer --question q1',
      ack,
      ack,
      'node src/scripts/sdlc.ts requirements --change demo --record-answer --question q2',
      ack,
    ],
    (file) => {
      const run = runMiner([file]);

      // The second copy of the first envelope arrives with no invocation
      // since the previous attributed slice — ignored. Only the third
      // envelope (after the second invocation) repeats.
      assert.equal(rowValue(run.stdout, 'invocations'), 2);
      assert.equal(rowValue(run.stdout, 'ack_repeat_candidates'), 1);
      assert.equal(run.status, 0);
    }
  );
});

test('differing instructions between identical acks break the repeat run', () => {
  const ack = '{"step": "discovery", "instructions": "Interview the stakeholder.", "data": {}}';
  const other = '{"step": "authoring", "instructions": "Update the artifact.", "data": {}}';
  withTempTranscript(
    [
      'node src/scripts/sdlc.ts requirements --change demo --record-answer --question q1',
      ack,
      'node src/scripts/sdlc.ts requirements --change demo --update-artifact',
      other,
      'node src/scripts/sdlc.ts requirements --change demo --record-answer --question q2',
      ack,
    ],
    (file) => {
      const run = runMiner([file]);

      assert.equal(rowValue(run.stdout, 'invocations'), 3);
      assert.equal(rowValue(run.stdout, 'ack_repeat_candidates'), 0);
    }
  );
});

test('an exploration without a preceding blocked envelope is counted but is not a diagnosis-loop candidate', () => {
  withTempTranscript(
    ['reading the engine source to answer a docs gap', 'codegraph_codegraph_explore finalizeArtifact'],
    (file) => {
      const run = runMiner([file]);

      assert.equal(rowValue(run.stdout, 'explorations'), 1);
      assert.equal(rowValue(run.stdout, 'diagnosis_loop_candidates'), 0);
      assertResultOk(run.stdout);
      assert.equal(run.status, 0);
    }
  );
});

test('a blocked envelope arms the diagnosis-loop detector until the next sdlc invocation', () => {
  withTempTranscript(
    [
      '{"step": "recovery", "state": "blocked", "instructions": "Fix the errors.", "data": {"errors": []}}',
      'codegraph_codegraph_explore finalizeArtifact',
      'node src/scripts/sdlc.ts requirements --change demo',
      'codegraph_codegraph_explore discovery gate',
    ],
    (file) => {
      const run = runMiner([file]);

      // The first explore follows the block (candidate); the invocation
      // disarms, so the second explore is plain volume.
      assert.equal(rowValue(run.stdout, 'explorations'), 2);
      assert.equal(rowValue(run.stdout, 'diagnosis_loop_candidates'), 1);
    }
  );
});

test('an escaped-JSON blocked state arms the detector the same way as raw JSON', () => {
  withTempTranscript(
    [
      'tool result: \\n  \\\"step\\\": \\\"recovery\\\", \\n  \\\"state\\\": \\\"blocked\\\", \\n  \\\"errors\\\": []',
      'codegraph_codegraph_explore discovery gate rule',
    ],
    (file) => {
      const run = runMiner([file]);

      assert.equal(rowValue(run.stdout, 'diagnosis_loop_candidates'), 1);
    }
  );
});

test('explorations within one post-block run collapse into a single candidate with the run size in verbose output', () => {
  withTempTranscript(
    [
      '{"step": "recovery", "state": "blocked", "instructions": "Fix the errors.", "data": {"errors": []}}',
      'grep -rn "instructions" src/scripts/lib/',
      'codegraph_codegraph_explore normalizeEnvelope instructions field',
      'node src/scripts/sdlc.ts status --change demo',
      'codegraph_codegraph_explore status workflow',
    ],
    (file) => {
      const run = runMiner([file, '--verbose']);

      assert.equal(rowValue(run.stdout, 'explorations'), 3);
      assert.equal(rowValue(run.stdout, 'diagnosis_loop_candidates'), 1);
      // One run of two events (block, grep, codegraph), then the invocation
      // disarms; the trailing explore is volume, not a second candidate.
      assertVerboseRow(run.stdout, 'label=transcript.txt:diagnosis_loop_run', 2);
    }
  );
});

test('a tool-call failure arms the diagnosis-loop detector like a blocked envelope', () => {
  withTempTranscript(
    [
      '"error": "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings."',
      'codegraph_codegraph_explore mergeArtifact writeYamlAtomic',
    ],
    (file) => {
      const run = runMiner([file]);

      assert.equal(rowValue(run.stdout, 'tool_failures'), 1);
      assert.equal(rowValue(run.stdout, 'diagnosis_loop_candidates'), 1);
      assert.equal(run.status, 0);
    }
  );
});

test('prose discussing tool failures never matches the closed signature catalog', () => {
  withTempTranscript(
    [
      'the review discussed schema errors and oldString misses at length',
      'makeError(\'SCHEMA_INVALID\', { message: \'Could not find oldString in the file\' })',
    ],
    (file) => {
      const run = runMiner([file]);

      // Prose and engine source shapes are not tool failures: only the
      // tool-runtime phrasing ("error": "...") matches.
      assert.equal(rowValue(run.stdout, 'tool_failures'), 0);
    }
  );
});
