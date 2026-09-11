import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { safeReadYaml } from '../../src/scripts/lib/context.ts';
import { recordAnswersBatch } from '../../src/scripts/lib/kinds/authoring.ts';
import type { AuthorEnv } from '../../src/scripts/lib/authoring-base.ts';
import hooks from '../../src/stages/requirements/hooks.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

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
  assert.equal(runCli(tmp, ['init', '--change', 'add-device-registration']).state, 'ok');
  const out = runCli(tmp, ['requirements', '--change', 'add-device-registration']);
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

// ---------------------------------------------------------------------------
// Stdin batch (`--record-answers -`): a YAML array on stdin avoids the
// write-then-record file deadlock. Invalid entries persist nothing.
// ---------------------------------------------------------------------------

test('--record-answers - reads the batch from stdin and allocates sequential DL ids', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-batch-stdin-'));
  assert.equal(runCli(tmp, ['init', '--change', 'add-device-registration']).state, 'ok');
  const out = runCli(tmp, ['requirements', '--change', 'add-device-registration']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  const stdin = [
    '- lens: stakeholder',
    '  question: Who is affected?',
    '  answer: Device owners.',
    '- lens: data',
    '  question: Is there a data model?',
    '  answer: Yes.',
    '- lens: failure',
    '  question: What happens on duplicates?',
    '  answer: Rejected with a conflict response.',
    '',
  ].join('\n');

  const batch = runCli(tmp, ['requirements', '--change', changeDir, '--record-answers', '-'], stdin);
  assert.notEqual(batch.state, 'blocked', JSON.stringify(batch));

  const saved = safeReadYaml(path.join(changeRoot, 'requirements.yaml')) as {
    discovery_log: Record<string, unknown>[];
  };
  assert.equal(saved.discovery_log.length, 3);
  assert.deepEqual(
    saved.discovery_log.map((entry) => entry.id),
    ['DL-001', 'DL-002', 'DL-003']
  );
});

test('--record-answers - with an invalid entry persists nothing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-batch-stdin-'));
  assert.equal(runCli(tmp, ['init', '--change', 'add-device-registration']).state, 'ok');
  const out = runCli(tmp, ['requirements', '--change', 'add-device-registration']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  const stdin = [
    '- lens: stakeholder',
    '  question: Who is affected?',
    '  answer: Device owners.',
    '- lens: design',
    '  question: Not in the vocabulary.',
    '  answer: Rejected.',
    '',
  ].join('\n');

  const out2 = runCli(tmp, ['requirements', '--change', changeDir, '--record-answers', '-'], stdin);
  assert.equal(out2.state, 'blocked', JSON.stringify(out2));
  assert.match(String(out2.instructions), /entry 1/);

  const saved = safeReadYaml(path.join(changeRoot, 'requirements.yaml')) as {
    discovery_log?: Record<string, unknown>[];
  };
  assert.equal((saved.discovery_log || []).length, 0, 'nothing persisted');
});
