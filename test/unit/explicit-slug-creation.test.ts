import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateChangeSlug, slugify } from '../../src/scripts/lib/ids.ts';
import { safeReadYaml } from '../../src/scripts/lib/context.ts';
import { createChangeDir, ChangeSlugError } from '../../src/scripts/lib/kinds/authoring.ts';
import { getStageById } from '../../src/scripts/lib/stage-registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function freshProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-explicit-slug-'));
}

function runCli(tmp: string, args: string[]) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return {
    out: JSON.parse(res.stdout) as Record<string, any>,
    status: res.status as number,
  };
}

function changesDir(tmp: string): string {
  return path.join(tmp, 'docs', 'changes');
}

function changeNames(tmp: string): string[] {
  if (!fs.existsSync(changesDir(tmp))) return [];
  return fs
    .readdirSync(changesDir(tmp), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// ---------------------------------------------------------------------------
// validateChangeSlug: pattern, 60-char budget, no trailing hyphen.
// ---------------------------------------------------------------------------

test('validateChangeSlug accepts valid slugs, including exactly-at-budget', () => {
  assert.equal(validateChangeSlug('a'), null);
  assert.equal(validateChangeSlug('change-2'), null);
  assert.equal(validateChangeSlug('add-device-registration'), null);
  assert.equal(validateChangeSlug('a'.repeat(60)), null);
});

test('validateChangeSlug rejects invalid charsets, leading hyphens, over-length, and trailing hyphens', () => {
  assert.match(validateChangeSlug('Bad_Name') as string, /may only contain lowercase letters, digits, and hyphens/);
  assert.match(validateChangeSlug('UPPER') as string, /may only contain lowercase letters, digits, and hyphens/);
  assert.match(validateChangeSlug('has space') as string, /may only contain lowercase letters, digits, and hyphens/);
  assert.match(validateChangeSlug('-leading') as string, /must start with a lowercase letter or digit/);
  assert.match(validateChangeSlug('') as string, /must start with a lowercase letter or digit/);
  assert.match(validateChangeSlug('a'.repeat(61)) as string, /maximum is 60/);
  assert.match(validateChangeSlug('abc-') as string, /must not end with a hyphen/);
});

// ---------------------------------------------------------------------------
// Explicit-slug creation (TASK-001): --change + --request with no matching
// change dir creates the change under the exact provided name.
// ---------------------------------------------------------------------------

test('--change + --request creates the change under the exact name and initializes from the request (CLI)', () => {
  const tmp = freshProject();
  const { out } = runCli(tmp, [
    'requirements',
    '--change',
    'my-explicit-change',
    '--request',
    'Add device registration',
  ]);

  assert.equal(out.state, 'in_progress', JSON.stringify(out));
  const changeRoot = out.data.change_root as string;
  assert.equal(path.basename(changeRoot), 'my-explicit-change');
  assert.deepEqual(changeNames(tmp), ['my-explicit-change']);

  const artifact = safeReadYaml(path.join(changeRoot, 'requirements.yaml')) as Record<string, any>;
  assert.equal(artifact.metadata.request_summary, 'Add device registration');
  assert.equal(artifact.metadata.title, 'Add device registration');
  assert.equal(artifact.metadata.status, 'draft');
  assert.equal(artifact.metadata.stage, 'requirements');
});

test('--change + --request rejects an invalid charset, naming the violation, creating nothing (CLI)', () => {
  const tmp = freshProject();
  const { out } = runCli(tmp, [
    'requirements',
    '--change',
    'Bad_Name',
    '--request',
    'Add device registration',
  ]);

  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.errors[0].code, 'INVALID_CHANGE_SLUG');
  assert.match(out.errors[0].message, /Bad_Name/);
  assert.match(out.errors[0].message, /may only contain lowercase letters, digits, and hyphens/);
  assert.equal(out.data.requested_change, 'Bad_Name');
  assert.ok(!fs.existsSync(changesDir(tmp)), 'nothing may be created for an invalid slug');
});

test('--change + --request rejects an over-length name, naming the violation, creating nothing (CLI)', () => {
  const tmp = freshProject();
  const long = 'a'.repeat(61);
  const { out } = runCli(tmp, ['requirements', '--change', long, '--request', 'Add device registration']);

  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.errors[0].code, 'INVALID_CHANGE_SLUG');
  assert.match(out.errors[0].message, /maximum is 60/);
  assert.ok(!fs.existsSync(changesDir(tmp)), 'nothing may be created for an invalid slug');
});

test('--change + --request rejects a trailing-hyphen name, naming the violation, creating nothing (CLI)', () => {
  const tmp = freshProject();
  const { out } = runCli(tmp, [
    'requirements',
    '--change',
    'abc-',
    '--request',
    'Add device registration',
  ]);

  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.errors[0].code, 'INVALID_CHANGE_SLUG');
  assert.match(out.errors[0].message, /must not end with a hyphen/);
  assert.ok(!fs.existsSync(changesDir(tmp)), 'nothing may be created for an invalid slug');
});

test('a colliding explicit slug is rejected, naming it and listing existing candidates', () => {
  const tmp = freshProject();
  const existing = path.join(changesDir(tmp));
  fs.mkdirSync(path.join(existing, 'existing-one'), { recursive: true });
  fs.mkdirSync(path.join(existing, 'existing-two'), { recursive: true });
  fs.writeFileSync(path.join(existing, 'existing-one', 'requirements.yaml'), 'metadata:\n  status: draft\n', 'utf8');

  const before = fs.readFileSync(path.join(existing, 'existing-one', 'requirements.yaml'), 'utf8');

  const stage = getStageById(root, 'requirements');
  assert.ok(stage, 'requirements stage record must load');

  assert.throws(
    () => createChangeDir(tmp, 'Add device registration', stage as never, 'existing-one'),
    (err: unknown) => {
      assert.ok(err instanceof ChangeSlugError);
      assert.equal(err.code, 'CHANGE_DIR_EXISTS');
      assert.match(err.message, /'existing-one' already exists/);
      assert.ok(err.message.includes('existing-one'));
      assert.ok(err.message.includes('existing-two'));
      assert.deepEqual(err.candidates, ['existing-one']);
      assert.deepEqual(err.available, ['existing-one', 'existing-two']);
      return true;
    }
  );

  assert.deepEqual(changeNames(tmp), ['existing-one', 'existing-two'], 'no new change directory may appear');
  assert.equal(
    fs.readFileSync(path.join(existing, 'existing-one', 'requirements.yaml'), 'utf8'),
    before,
    'the existing change must be left untouched'
  );
});

// ---------------------------------------------------------------------------
// Byte-identical neighbors: bare --request still slugifies; --change alone
// still resolves and resumes.
// ---------------------------------------------------------------------------

test('bare --request still slugifies mechanically (CLI)', () => {
  const tmp = freshProject();
  const { out } = runCli(tmp, ['requirements', '--request', 'Add Device Registration!!']);

  assert.equal(out.state, 'in_progress', JSON.stringify(out));
  const changeRoot = out.data.change_root as string;
  assert.equal(path.basename(changeRoot), slugify('Add Device Registration!!'));
  assert.equal(path.basename(changeRoot), 'add-device-registration');
});

test('--change alone on an existing change resumes without re-creation (CLI)', () => {
  const tmp = freshProject();
  const first = runCli(tmp, ['requirements', '--request', 'Add device registration']);
  const changeRoot = first.out.data.change_root as string;
  const name = path.basename(changeRoot);
  const artifactFile = path.join(changeRoot, 'requirements.yaml');
  const before = fs.readFileSync(artifactFile, 'utf8');

  const second = runCli(tmp, ['requirements', '--change', name]);

  assert.equal(second.out.state, 'in_progress', JSON.stringify(second.out));
  assert.equal(second.out.data.change_root, changeRoot);
  assert.deepEqual(changeNames(tmp), [name], 'exactly one change directory must exist');
  assert.ok(
    !second.out.warnings.some((w: any) => w.code === 'ARTIFACT_INITIALIZED'),
    'the artifact must not be re-initialized on resume'
  );
  assert.equal(fs.readFileSync(artifactFile, 'utf8'), before, 'the artifact must be unchanged on resume');
});