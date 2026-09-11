import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeEnvelope } from '../../src/scripts/lib/cli.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const skillMd = fs.readFileSync(
  path.join(root, 'src', 'skills', 'agentic-sdlc', 'SKILL.md'),
  'utf8'
);

// ---------------------------------------------------------------------------
// State vocabulary (FR-009): the state values the skill enumerates must
// round-trip through normalizeEnvelope unchanged — the skill's loop reads
// `state` off the normalized envelope, so any vocabulary drift between the
// skill text and the CLI's normalizer breaks the loop contract.
// ---------------------------------------------------------------------------

test('the skill state vocabulary round-trips through normalizeEnvelope', () => {
  // The skill enumerates exactly in_progress | blocked | complete (plus the
  // init/heartbeat ok state) — extract the enumerated vocabulary from the text.
  assert.match(skillMd, /State values are `in_progress`, `blocked`, and `complete`/);

  for (const state of ['in_progress', 'blocked', 'complete']) {
    const envelope = normalizeEnvelope({
      command: 'status',
      step: 'pipeline',
      state,
      instructions: 'probe',
      data: {},
      errors: [],
      warnings: [],
    });
    assert.equal(envelope.state, state, `state '${state}' must round-trip unchanged`);
  }

  // The ok state (init's creation envelope) also round-trips.
  assert.equal(
    normalizeEnvelope({ command: 'init', state: 'ok', instructions: 'probe' }).state,
    'ok'
  );
});

test('an unknown state value falls back deterministically (the skill unknown-value default)', () => {
  // The skill's unknown-value default: follow the top-level instructions
  // field. normalizeEnvelope must preserve the instructions field while
  // coercing the unknown state (errors present -> blocked, else ok).
  const withErrors = normalizeEnvelope({
    state: 'mystery',
    instructions: 'follow me',
    errors: [{ message: 'boom' }],
  });
  assert.equal(withErrors.state, 'blocked');
  assert.equal(withErrors.instructions, 'follow me');

  const withoutErrors = normalizeEnvelope({ state: 'mystery', instructions: 'follow me' });
  assert.equal(withoutErrors.state, 'ok');
  assert.equal(withoutErrors.instructions, 'follow me');
});

// ---------------------------------------------------------------------------
// data.stage (FR-009 loop step 2): the status command's emitting code must
// carry the field the skill reads.
// ---------------------------------------------------------------------------

test('status.ts emits data.stage (the field the skill loop reads)', () => {
  const statusSource = fs.readFileSync(
    path.join(root, 'src', 'scripts', 'commands', 'status.ts'),
    'utf8'
  );

  // The slim data shape carries change_name, stage, agent, suggested_command.
  assert.match(statusSource, /change_name: changeDir/);
  assert.match(statusSource, /\bstage,\s*\n\s*agent:/);
  assert.match(statusSource, /suggested_command: suggestedCommand/);
});

// ---------------------------------------------------------------------------
// data.semantic_checks (FR-006 payload exception): review rounds pass the
// declared check names verbatim from data.semantic_checks — the review kind
// must emit that field.
// ---------------------------------------------------------------------------

test('review.ts emits data.semantic_checks (the field the skill passes verbatim)', () => {
  const reviewSource = fs.readFileSync(
    path.join(root, 'src', 'scripts', 'lib', 'kinds', 'review.ts'),
    'utf8'
  );

  assert.match(reviewSource, /semantic_checks: checks/);
  assert.match(reviewSource, /semantic_checks: semanticChecksFor\(trackedStage\)/);
});

// ---------------------------------------------------------------------------
// data.round (FR-008 authoring guard): the skill reads the authoring run
// count from data.round on the review envelope — the emitting code must
// record it.
// ---------------------------------------------------------------------------

test('review.ts records data.round (the field the authoring guard reads)', () => {
  const reviewSource = fs.readFileSync(
    path.join(root, 'src', 'scripts', 'lib', 'kinds', 'review.ts'),
    'utf8'
  );

  assert.match(reviewSource, /round: recordedRound/);
});

// ---------------------------------------------------------------------------
// data.suggested_command and data.agent (FR-006 delegation template): the
// fields the fixed template hands over must exist on the status envelope.
// ---------------------------------------------------------------------------

test('the skill references the envelope fields the status emitter carries', () => {
  // The skill text references the fields...
  assert.match(skillMd, /data\.stage/);
  assert.match(skillMd, /data\.agent/);
  assert.match(skillMd, /data\.suggested_command/);
  assert.match(skillMd, /data\.semantic_checks/);
  assert.match(skillMd, /data\.round/);
  assert.match(skillMd, /data\.change_name/);
  assert.match(skillMd, /data\.available_changes/);
});
