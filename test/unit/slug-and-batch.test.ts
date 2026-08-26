import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { slugify } from '../../src/scripts/lib/ids.ts';
import { safeReadYaml } from '../../src/scripts/lib/context.ts';
import { recordAnswersBatch } from '../../src/scripts/lib/kinds/authoring.ts';
import type { AuthorEnv } from '../../src/scripts/lib/authoring-base.ts';
import hooks from '../../src/stages/requirements/hooks.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

// ---------------------------------------------------------------------------
// Word-boundary slugs (TASK-009): truncation drops whole words, never
// mid-word, within the same 60-char budget, with no trailing hyphen.
// ---------------------------------------------------------------------------

test('slugify keeps short titles unchanged', () => {
  assert.equal(slugify('Add Device Registration'), 'add-device-registration');
  assert.equal(slugify('Fix login bug'), 'fix-login-bug');
});

test('slugify strips punctuation and collapses separators', () => {
  assert.equal(slugify('  Weird / Text !! '), 'weird-text');
  assert.equal(slugify('Add -- user & role!!!management'), 'add-user-role-management');
});

test('slugify truncates long titles at word boundaries without a trailing hyphen', () => {
  const slug = slugify(
    'Implement comprehensive observability dashboards for distributed tracing infrastructure'
  );

  // Old behavior sliced mid-word: ...dashboards-for-distr.
  assert.equal(slug, 'implement-comprehensive-observability-dashboards-for');
  assert.ok(slug.length <= 60);
  assert.ok(!slug.endsWith('-'));
});

test('slugify keeps exactly-at-budget words whole and drops overflow words whole', () => {
  // Five 10-char words plus one 5-char word joined by hyphens is exactly 60.
  const atBudget = 'aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee fffff';
  const slug = slugify(atBudget);
  assert.equal(slug, 'aaaaaaaaaa-bbbbbbbbbb-cccccccccc-dddddddddd-eeeeeeeeee-fffff');
  assert.equal(slug.length, 60);

  // One more word pushes past the budget; it is dropped whole, leaving the
  // exactly-at-budget prefix untouched.
  assert.equal(
    slugify(`${atBudget} gggggggggg`),
    slug
  );
});

test('slugify hard-truncates a single word longer than the budget', () => {
  // A single over-long word cannot be kept whole; the only way to stay within
  // budget is to slice it (still no trailing hyphen).
  assert.equal(slugify('a'.repeat(80)), 'a'.repeat(60));
});

test('slugify falls back to "change" for empty or punctuation-only input', () => {
  assert.equal(slugify(''), 'change');
  assert.equal(slugify('!!! ###'), 'change');
});

// ---------------------------------------------------------------------------
// Batch discovery recording (--record-answers): every entry routes through the
// same recordAnswer hook as the singular flag, with sequential DL ids.
// ---------------------------------------------------------------------------

// A valid policy matching the shipped FR-004 vocabulary, used to build fixture
// stage folders (same shape as requirements-stage.test.ts).
const VALID_POLICY = `version: 1

discovery:
  lenses:
    - stakeholder
    - scope
    - interface
    - behavior
    - data
    - constraint
    - failure
    - outcome

  clarity:
    clear:
      required_lenses:
        - failure
        - constraint
      min_resolved_questions: 3
    partial:
      required_lenses:
        - stakeholder
        - interface
        - data
        - failure
        - constraint
      min_resolved_questions: 5
    vague:
      required_lenses:
        - stakeholder
        - scope
        - interface
        - behavior
        - data
        - constraint
        - failure
        - outcome
      min_resolved_questions: 8
`;

function fixtureStageFolder(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-policy-'));
  const folder = path.join(tmp, 'requirements');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'requirements-policy.yaml'), VALID_POLICY, 'utf8');
  return folder;
}

function makeEnv(
  folder: string,
  artifact: Record<string, unknown>,
  args: Record<string, unknown>
): AuthorEnv {
  return {
    args,
    cwd: root,
    changeRoot: '/tmp/change',
    artifactPath: null,
    artifact,
    stage: { id: 'requirements', folder },
    warnings: [],
    hooks,
    readYaml: safeReadYaml,
  } as unknown as AuthorEnv;
}

function writeAnswersFile(entries: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-answers-'));
  const file = path.join(tmp, 'answers.yaml');
  fs.writeFileSync(file, entries, 'utf8');
  return file;
}

test('recordAnswersBatch records every entry through the hook with sequential DL ids', () => {
  const folder = fixtureStageFolder();
  const artifact = {
    metadata: {},
    discovery_log: [
      { id: 'DL-001', question: 'q0', answer: 'a0', lens: 'scope', resolved: true },
    ],
  };
  const file = writeAnswersFile(
    [
      '- lens: stakeholder',
      '  question: Who is affected?',
      '  answer: Device owners.',
      '- lens: data',
      '  question: Is there a data model?',
      '  answer: Yes.',
      '',
    ].join('\n')
  );

  const env = makeEnv(folder, artifact, { 'record-answers': file });
  recordAnswersBatch(env);

  const log = (env.artifact as { discovery_log: Record<string, unknown>[] }).discovery_log;
  assert.equal(log.length, 3);
  assert.equal(log[1].id, 'DL-002');
  assert.equal(log[1].lens, 'stakeholder');
  assert.equal(log[1].question, 'Who is affected?');
  assert.equal(log[1].resolved, true);
  assert.equal(log[2].id, 'DL-003');
  assert.equal(log[2].lens, 'data');
  assert.equal(log[2].resolved, true);
});

test('recordAnswersBatch fails naming the entry index for an invalid entry', () => {
  const folder = fixtureStageFolder();
  const file = writeAnswersFile(
    [
      '- lens: stakeholder',
      '  question: Who is affected?',
      '  answer: Device owners.',
      '- lens: design',
      '  question: Not in the vocabulary.',
      '  answer: Rejected.',
      '',
    ].join('\n')
  );

  const env = makeEnv(folder, { metadata: {}, discovery_log: [] }, { 'record-answers': file });
  assert.throws(
    () => recordAnswersBatch(env),
    (err: unknown) => {
      const e = err as { message?: string };
      assert.match(String(e.message), /entry 1/);
      assert.match(String(e.message), /design/);
      return true;
    }
  );
});

test('recordAnswersBatch fails naming the entry index for a non-object entry', () => {
  const folder = fixtureStageFolder();
  const file = writeAnswersFile('- just-a-string\n');

  const env = makeEnv(folder, { metadata: {}, discovery_log: [] }, { 'record-answers': file });
  assert.throws(
    () => recordAnswersBatch(env),
    (err: unknown) => {
      const e = err as { message?: string };
      assert.match(String(e.message), /entry 0 must be an object/);
      return true;
    }
  );
});

test('recordAnswersBatch gives a clear error for a missing file', () => {
  const folder = fixtureStageFolder();
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'batch-missing-')), 'nope.yaml');

  const env = makeEnv(folder, { metadata: {}, discovery_log: [] }, { 'record-answers': missing });
  assert.throws(
    () => recordAnswersBatch(env),
    (err: unknown) => {
      const e = err as { message?: string };
      assert.match(String(e.message), /file not found/);
      assert.match(String(e.message), /nope\.yaml/);
      return true;
    }
  );
});

test('recordAnswersBatch rejects a file that is not a YAML array', () => {
  const folder = fixtureStageFolder();
  const file = writeAnswersFile('lens: stakeholder\nquestion: q\nanswer: a\n');

  const env = makeEnv(folder, { metadata: {}, discovery_log: [] }, { 'record-answers': file });
  assert.throws(
    () => recordAnswersBatch(env),
    (err: unknown) => {
      const e = err as { message?: string };
      assert.match(String(e.message), /YAML array/);
      return true;
    }
  );
});

// End-to-end through the real --record-answers flag handler.
function runCli(tmp: string, args: string[], input?: string) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('--record-answers persists every batch entry to the artifact (CLI)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-batch-'));
  const out = runCli(tmp, ['requirements', '--request', 'Add device registration']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  const answersFile = path.join(tmp, 'answers.yaml');
  fs.writeFileSync(
    answersFile,
    [
      '- lens: stakeholder',
      '  question: Who is affected?',
      '  answer: Device owners.',
      '- lens: data',
      '  question: Is there a data model?',
      '  answer: Yes.',
      '',
    ].join('\n'),
    'utf8'
  );

  const batch = runCli(tmp, ['requirements', '--change', changeDir, '--record-answers', answersFile]);
  assert.notEqual(batch.state, 'blocked', JSON.stringify(batch));

  const saved = safeReadYaml(path.join(changeRoot, 'requirements.yaml')) as {
    discovery_log: Record<string, unknown>[];
  };
  assert.equal(saved.discovery_log.length, 2);
  assert.equal(saved.discovery_log[0].id, 'DL-001');
  assert.equal(saved.discovery_log[1].id, 'DL-002');
  assert.equal(saved.discovery_log[1].resolved, true);
});
