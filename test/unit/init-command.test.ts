import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function freshProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-init-command-'));
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
// Happy path (AC-001): mkdir-only creation, heartbeat-pointing instructions.
// ---------------------------------------------------------------------------

test('init creates exactly the change directory and returns state ok with change_name (CLI)', () => {
  const tmp = freshProject();
  const { out, status } = runCli(tmp, ['init', '--change', 'my-new-change']);

  assert.equal(status, 0, JSON.stringify(out));
  assert.equal(out.command, 'init');
  assert.equal(out.state, 'ok', JSON.stringify(out));
  assert.equal(out.data.change_name, 'my-new-change');
  assert.match(out.instructions, /sdlc status --change my-new-change/);
  assert.deepEqual(changeNames(tmp), ['my-new-change']);

  // Exactly one directory was created: docs/changes/my-new-change. No
  // artifact, no request.md, no other file anywhere under docs/.
  const created = path.join(changesDir(tmp), 'my-new-change');
  assert.deepEqual(fs.readdirSync(created), [], 'the change directory must be empty');
});

test('init creates docs/changes itself when absent and its instructions point at the heartbeat', () => {
  const tmp = freshProject();
  assert.ok(!fs.existsSync(changesDir(tmp)), 'precondition: no docs/changes yet');

  const { out } = runCli(tmp, ['init', '--change', 'fresh-slug']);

  assert.equal(out.state, 'ok', JSON.stringify(out));
  assert.ok(fs.existsSync(changesDir(tmp)), 'docs/changes must be created');
  assert.deepEqual(changeNames(tmp), ['fresh-slug']);
  assert.match(out.instructions, /heartbeat|sdlc status/);
});

// ---------------------------------------------------------------------------
// Slug validation (AC-002): INVALID_CHANGE_SLUG, nothing created.
// ---------------------------------------------------------------------------

test('init rejects an invalid charset with INVALID_CHANGE_SLUG and creates nothing (CLI)', () => {
  const tmp = freshProject();
  const { out, status } = runCli(tmp, ['init', '--change', 'Bad_Name']);

  assert.equal(status, 2, JSON.stringify(out));
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.errors[0].code, 'INVALID_CHANGE_SLUG');
  assert.match(out.errors[0].message, /Bad_Name/);
  assert.match(out.errors[0].message, /may only contain lowercase letters, digits, and hyphens/);
  assert.equal(out.data.requested_change, 'Bad_Name');
  assert.ok(!fs.existsSync(changesDir(tmp)), 'nothing may be created for an invalid slug');
});

test('init rejects a trailing-hyphen slug with INVALID_CHANGE_SLUG and creates nothing (CLI)', () => {
  const tmp = freshProject();
  const { out } = runCli(tmp, ['init', '--change', 'abc-']);

  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.errors[0].code, 'INVALID_CHANGE_SLUG');
  assert.match(out.errors[0].message, /must not end with a hyphen/);
  assert.ok(!fs.existsSync(changesDir(tmp)), 'nothing may be created for an invalid slug');
});

test('init rejects an over-length slug with INVALID_CHANGE_SLUG and creates nothing (CLI)', () => {
  const tmp = freshProject();
  const long = 'a'.repeat(61);
  const { out } = runCli(tmp, ['init', '--change', long]);

  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.errors[0].code, 'INVALID_CHANGE_SLUG');
  assert.match(out.errors[0].message, /maximum is 60/);
  assert.ok(!fs.existsSync(changesDir(tmp)), 'nothing may be created for an invalid slug');
});

// ---------------------------------------------------------------------------
// Duplicate refusal (AC-003): CHANGE_DIR_EXISTS, untouched, no suffix.
// ---------------------------------------------------------------------------

test('init refuses an existing change with CHANGE_DIR_EXISTS, leaving it untouched (CLI)', () => {
  const tmp = freshProject();
  const existingDir = path.join(changesDir(tmp), 'existing-one');
  fs.mkdirSync(existingDir, { recursive: true });
  fs.writeFileSync(
    path.join(existingDir, 'requirements.yaml'),
    'metadata:\n  status: draft\n',
    'utf8'
  );
  fs.mkdirSync(path.join(changesDir(tmp), 'existing-two'), { recursive: true });

  const before = fs.readFileSync(path.join(existingDir, 'requirements.yaml'), 'utf8');

  const { out, status } = runCli(tmp, ['init', '--change', 'existing-one']);

  assert.equal(status, 2, JSON.stringify(out));
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.errors[0].code, 'CHANGE_DIR_EXISTS');
  assert.match(out.errors[0].message, /'existing-one' already exists/);
  assert.ok(out.errors[0].message.includes('existing-two'), 'available changes are listed');
  assert.deepEqual(out.data.available_changes, ['existing-one', 'existing-two']);

  // No suffixed variant, no second directory, existing content untouched.
  assert.deepEqual(changeNames(tmp), ['existing-one', 'existing-two']);
  assert.equal(fs.readFileSync(path.join(existingDir, 'requirements.yaml'), 'utf8'), before);
});

// ---------------------------------------------------------------------------
// Closed vocabulary (AC-004): --request is not declared, so it is an
// UNKNOWN_FLAG by construction.
// ---------------------------------------------------------------------------

test('init refuses --request with UNKNOWN_FLAG before any effect (CLI)', () => {
  const tmp = freshProject();
  const { out, status } = runCli(tmp, [
    'init',
    '--change',
    'no-request-here',
    '--request',
    'Add device registration',
  ]);

  assert.equal(status, 2, JSON.stringify(out));
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.errors[0].code, 'UNKNOWN_FLAG');
  assert.match(out.errors[0].message, /--request/);
  assert.ok(!fs.existsSync(changesDir(tmp)), 'nothing may be created when parsing fails');
});

// ---------------------------------------------------------------------------
// No request.md (AC-013): the created directory carries no request text.
// ---------------------------------------------------------------------------

test('the created change directory contains no request.md and no request text', () => {
  const tmp = freshProject();
  const { out } = runCli(tmp, ['init', '--change', 'no-request-md']);

  assert.equal(out.state, 'ok', JSON.stringify(out));

  const created = path.join(changesDir(tmp), 'no-request-md');
  const entries = fs.readdirSync(created, { withFileTypes: true }).map((e) => e.name);

  assert.ok(!entries.includes('request.md'), 'no request.md may exist');
  assert.deepEqual(entries, [], 'the directory must be empty — no file carries the request text');
});

// ---------------------------------------------------------------------------
// Resume semantics: --change alone on an existing change resumes without
// re-creation (migrated from the retired explicit-slug-creation tests).
// ---------------------------------------------------------------------------

test('--change alone on an existing change resumes without re-creation (CLI)', () => {
  const tmp = freshProject();
  assert.equal(runCli(tmp, ['init', '--change', 'add-device-registration']).out.state, 'ok');
  const first = runCli(tmp, ['requirements', '--change', 'add-device-registration']);
  const changeRoot = String(first.out.data.change_root);
  const artifactFile = path.join(changeRoot, 'requirements.yaml');
  const before = fs.readFileSync(artifactFile, 'utf8');

  const second = runCli(tmp, ['requirements', '--change', 'add-device-registration']);

  assert.equal(second.out.state, 'in_progress', JSON.stringify(second.out));
  assert.equal(second.out.data.change_root, changeRoot);
  assert.deepEqual(changeNames(tmp), ['add-device-registration'], 'exactly one change directory must exist');
  assert.ok(
    !second.out.warnings.some((w: any) => w.code === 'ARTIFACT_INITIALIZED'),
    'the artifact must not be re-initialized on resume'
  );
  assert.equal(fs.readFileSync(artifactFile, 'utf8'), before, 'the artifact must be unchanged on resume');
});
