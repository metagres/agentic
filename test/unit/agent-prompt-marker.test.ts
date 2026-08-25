import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROMPT_MARKERS,
  findPromptMarkers,
} from '../../src/scripts/lib/agent-prompt-marker.ts';

test('flag markers are detected', () => {
  assert.deepEqual(findPromptMarkers('Never run --finalize before review.'), ['--finalize']);
  assert.deepEqual(
    findPromptMarkers('Use --accept or --reject to record the verdict.'),
    ['--accept', '--reject']
  );
});

test('the script path marker is detected', () => {
  const found = findPromptMarkers('Run scripts/sdlc.js status first.');
  assert.ok(found.includes('scripts/sdlc.js'));
});

test('directive phrase markers are detected', () => {
  assert.deepEqual(findPromptMarkers('Read the instructions field before acting.'), [
    'the instructions field',
  ]);
  assert.deepEqual(
    findPromptMarkers('The data field carries the payload and the envelope wraps it.'),
    ['the data field', 'the envelope']
  );
});

test('detection is case-insensitive', () => {
  assert.deepEqual(findPromptMarkers('Check THE INSTRUCTIONS FIELD contract.'), [
    'the instructions field',
  ]);
  assert.deepEqual(findPromptMarkers('Pass --FINALIZE after semantic validation.'), [
    '--finalize',
  ]);
  assert.deepEqual(findPromptMarkers('This is the SDLC lifecycle.'), ['sdlc']);
});

test('clean personality prose passes with no markers', () => {
  const prompt = [
    'You are an adversarial reviewer who verifies claims against evidence.',
    'Every assertion must be quoted, not paraphrased, and traceability is checked relentlessly.',
    'You accept a claim only when it derives from the source of truth.',
    'You reject with specifics; politeness is not part of the verdict.',
    'Data flow across component boundaries must be explicit and auditable.',
  ].join('\n');
  assert.deepEqual(findPromptMarkers(prompt), []);
});

test("the bare word 'data' does not trigger the 'the data field' phrase", () => {
  assert.deepEqual(findPromptMarkers('Data flows must be explicit.'), []);
  assert.deepEqual(findPromptMarkers('The data field carries the payload.'), ['the data field']);
});

test("the plain verb 'accept' does not trigger the '--accept' flag", () => {
  assert.deepEqual(findPromptMarkers('You accept only evidence-backed claims.'), []);
  assert.deepEqual(findPromptMarkers('Pass --accept to approve.'), ['--accept']);
});

test('every marker in the list is detected when present', () => {
  for (const marker of PROMPT_MARKERS) {
    const found = findPromptMarkers(`Say: ${marker}`);
    assert.ok(found.includes(marker), `marker '${marker}' was not detected`);
  }
});
