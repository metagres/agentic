import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OUTPUT_DISCIPLINE_FRAGMENT,
  OUTPUT_DISCIPLINE_MARKER,
  FRAGMENT_MARKERS,
  composeEffectivePrompt,
  findFragmentMarkers,
} from '../../src/scripts/lib/agent-output-discipline.ts';

const REPLY_RULES = [
  'No preamble, acknowledgments, or self-introduction; start with the substance.',
  "Never restate the user's request or the step instructions you were given.",
  'Never recap CLI envelope or tool output the user can already see.',
  'A finished step is reported in one line: what is done and the artifact path.',
  'When blocked, state what is blocked, why, and what unblocks it.',
];

const REASONING_RULES = [
  'do not restate the request or instructions',
  'no audience-addressed filler',
  'reason in fragments of facts, options, and decisions',
];

test('the fragment fits the twelve-line cap (DM-001: seven lines)', () => {
  const lineCount = OUTPUT_DISCIPLINE_FRAGMENT.split('\n').length;
  assert.ok(lineCount <= 12, `fragment has ${lineCount} lines, cap is 12`);
  assert.equal(lineCount, 7);
});

test('all five reply rules appear in the fragment (AC-007)', () => {
  for (const rule of REPLY_RULES) {
    assert.ok(
      OUTPUT_DISCIPLINE_FRAGMENT.includes(rule),
      `reply rule missing: ${rule}`
    );
  }
});

test('all three reasoning rules appear in the fragment (AC-009)', () => {
  for (const rule of REASONING_RULES) {
    assert.ok(
      OUTPUT_DISCIPLINE_FRAGMENT.includes(rule),
      `reasoning rule missing: ${rule}`
    );
  }
});

test('the fragment imposes no token-count cap (AC-008)', () => {
  // The header declares the absence of a cap; no numeric token limit,
  // max_tokens setting, or budget wording may appear anywhere.
  assert.ok(OUTPUT_DISCIPLINE_FRAGMENT.includes('no token cap'));
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /max[_ ]?tokens/i);
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /token budget/i);
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /at most \d+ tokens/i);
});

test('the fragment contains no telegraphic language rules (AC-008)', () => {
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /omit articles?/i);
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /drop articles?/i);
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /symbol[s]? over words/i);
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /first[- ]person ban/i);
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /never use (the )?first[- ]person/i);
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /no pronouns/i);
});

test('the reasoning rules are guidance with no enforcement claim and no numeric cap (AC-010)', () => {
  const reasoningLine = OUTPUT_DISCIPLINE_FRAGMENT
    .split('\n')
    .find((line) => line.startsWith('When reasoning:'));
  assert.ok(reasoningLine, 'a reasoning line exists');

  assert.doesNotMatch(reasoningLine, /\d/, 'no numeric cap in the reasoning rules');
  assert.doesNotMatch(reasoningLine, /enforc/i, 'no enforcement claim');
  assert.doesNotMatch(reasoningLine, /reject/i, 'no rejection claim');
  assert.doesNotMatch(reasoningLine, /violat/i, 'no violation claim');
  assert.doesNotMatch(reasoningLine, /\bmust\b/i, 'no binding modal');
});

test('the fragment is rules only: no worked examples and no role content (AC-017)', () => {
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /for example/i);
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /e\.g\./i);
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /such as/i);
  // No role narration: the fragment never says what the agent is.
  assert.doesNotMatch(OUTPUT_DISCIPLINE_FRAGMENT, /you are (a|an)\b/i);
});

test('composeEffectivePrompt returns role prompt, blank line, fragment, and never mutates its input', () => {
  const rolePrompt = 'You are a neutral agent.';
  const snapshot = rolePrompt;

  const composed = composeEffectivePrompt(rolePrompt);

  assert.equal(composed, `${rolePrompt}\n\n${OUTPUT_DISCIPLINE_FRAGMENT}`);
  assert.equal(rolePrompt, snapshot, 'input string is unchanged');
  assert.ok(composed.startsWith(`${rolePrompt}\n\n`), 'role prompt verbatim, one blank line');
  assert.ok(composed.endsWith(OUTPUT_DISCIPLINE_FRAGMENT), 'fragment last');
});

test('the stable smoke marker appears verbatim in the fragment', () => {
  assert.ok(OUTPUT_DISCIPLINE_FRAGMENT.includes(OUTPUT_DISCIPLINE_MARKER));
});

test('every marker is derived from the fragment text and detected in it, in list order', () => {
  for (const marker of FRAGMENT_MARKERS) {
    assert.ok(
      OUTPUT_DISCIPLINE_FRAGMENT.toLowerCase().includes(marker.toLowerCase()),
      `marker '${marker}' does not occur in the fragment text`
    );
  }
  assert.deepEqual(findFragmentMarkers(OUTPUT_DISCIPLINE_FRAGMENT), [...FRAGMENT_MARKERS]);
});

test('marker detection is case-insensitive and reports list order without duplicates', () => {
  const embedded = [
    'You review pull requests.',
    'NEVER RECAP CLI ENVELOPE output in your replies.',
    'Keep the no preamble, acknowledgments, or self-introduction rule in mind.',
    'no audience-addressed filler, please.',
  ].join('\n');

  assert.deepEqual(findFragmentMarkers(embedded), [
    'No preamble, acknowledgments, or self-introduction',
    'Never recap CLI envelope',
    'no audience-addressed filler',
  ]);
});

test('a clean prompt yields no markers', () => {
  const prompt = [
    'You are an adversarial reviewer who verifies claims against evidence.',
    'Every assertion must be quoted, not paraphrased, and traceability is checked relentlessly.',
    'You accept a claim only when it derives from the source of truth.',
  ].join('\n');
  assert.deepEqual(findFragmentMarkers(prompt), []);
});
