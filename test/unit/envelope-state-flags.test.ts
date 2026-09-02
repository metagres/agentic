import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getData } from '../../src/scripts/lib/authoring-base.ts';
import type { AuthorEnv } from '../../src/scripts/lib/authoring-base.ts';
import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { validateWithSchema } from '../../src/scripts/lib/schema.ts';
import { validRequirements } from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

// Minimal AuthorEnv over the shipped requirements steps.yaml: getData reads
// the artifact, blocking, hooks, and stage.files.steps.
function makeEnv(artifact: Record<string, unknown> | null): AuthorEnv {
  return {
    args: {},
    cwd: root,
    changeRoot: '/tmp/change',
    artifactPath: null,
    artifact,
    stage: {
      id: 'requirements',
      files: { steps: path.join(root, 'src', 'stages', 'requirements', 'steps.yaml') },
    } as unknown as AuthorEnv['stage'],
    warnings: [],
    hooks: null,
    readYaml: () => null,
    blocking: [],
  } as AuthorEnv;
}

function artifactWithStatus(status?: string, extraMetadata: Record<string, unknown> = {}) {
  const metadata: Record<string, unknown> = {
    id: 'REQ-001',
    title: 'T',
    stage: 'requirements',
    version: '0.1.0',
    created: '2026-09-02',
    updated: '2026-09-02',
    ...extraMetadata,
  };
  if (status) metadata.status = status;
  return { metadata };
}

// Tmp project with the docs/current fixture the delta validation reads.
function tmpProject(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'index.md'),
    [
      '# Current Docs Index',
      '',
      '| File | Purpose | When to Read | Notes |',
      '|---|---|---|---|',
      '| docs/current/architecture.md | Tech stack, boundaries, folder responsibilities | Structural changes | Fixture |',
      '',
    ].join('\n'),
    'utf8'
  );
  return tmp;
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

function assertEnvelopeShape(payload: Record<string, unknown>) {
  const findings = validateWithSchema(payload, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, []);
}

test('getData derives semantic_complete from artifact metadata status', () => {
  // draft -> false.
  assert.equal(getData(makeEnv(artifactWithStatus('draft'))).semantic_complete, false);
  // ready-for-review -> true.
  assert.equal(getData(makeEnv(artifactWithStatus('ready-for-review'))).semantic_complete, true);
  // accepted -> true.
  assert.equal(getData(makeEnv(artifactWithStatus('accepted'))).semantic_complete, true);
  // rejected -> false.
  assert.equal(getData(makeEnv(artifactWithStatus('rejected'))).semantic_complete, false);
  // missing artifact -> false.
  assert.equal(getData(makeEnv(null)).semantic_complete, false);
  // A legacy metadata step key must not influence the derivation.
  assert.equal(
    getData(makeEnv(artifactWithStatus('draft', { step: 'complete' }))).semantic_complete,
    false
  );
  assert.equal(
    getData(makeEnv(artifactWithStatus('accepted', { step: 'init' }))).semantic_complete,
    true
  );
});

test('a change created through --request persists no step key', () => {
  const tmp = tmpProject('agentic-esf-');

  const out = runCli(tmp, ['requirements', '--request', 'Add device registration']);
  assertEnvelopeShape(out);
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  const artifactPath = path.join(String(out.data.change_root), 'requirements.yaml');
  const saved = readYaml(artifactPath) as { metadata: Record<string, unknown> };
  assert.equal(saved.metadata.status, 'draft');
  assert.equal(saved.metadata.step, undefined);

  // The envelope metadata mirror reports no step key either.
  assert.equal((out.data.metadata as Record<string, unknown>).step, undefined);
});

test('finalize with --confirm-semantic writes ready-for-review and no step key', () => {
  const tmp = tmpProject('agentic-esf-');

  let out = runCli(tmp, ['requirements', '--request', 'Add device registration']);
  const changeDir = path.basename(String(out.data.change_root));
  const artifactPath = path.join(String(out.data.change_root), 'requirements.yaml');

  out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({}))
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  out = runCli(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const saved = readYaml(artifactPath) as { metadata: Record<string, unknown> };
  assert.equal(saved.metadata.status, 'ready-for-review');
  assert.equal(saved.metadata.step, undefined);

  // The next standard envelope reports the revalued flag from status.
  out = runCli(tmp, ['requirements', '--change', changeDir]);
  assert.equal(out.data.semantic_complete, true);
  assert.equal((out.data.metadata as Record<string, unknown>).step, undefined);
});

test('a legacy artifact step key survives an engine mutation', () => {
  const tmp = tmpProject('agentic-esf-');

  let out = runCli(tmp, ['requirements', '--request', 'Add device registration']);
  const changeDir = path.basename(String(out.data.change_root));
  const artifactPath = path.join(String(out.data.change_root), 'requirements.yaml');

  out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({}))
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));

  // Simulate a legacy file carrying the stale key the engine no longer writes.
  const legacy = readYaml(artifactPath) as { metadata: Record<string, unknown> };
  legacy.metadata.step = 'complete';
  fs.writeFileSync(artifactPath, JSON.stringify(legacy), 'utf8');

  // A mutation rewrites the file; unmanaged metadata keys must be preserved
  // (AC-012) — the engine performs no legacy-key migration or stripping.
  out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({}))
  );

  const saved = readYaml(artifactPath) as { metadata: Record<string, unknown> };
  assert.equal(saved.metadata.step, 'complete');

  // After the schema tightening (DEC-004/DEC-007) the stale key is a blocking
  // schema finding, so the envelope reports the recovery step and blocked state.
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.step, 'recovery');
});

test('the standard authoring envelope carries exactly the seven frozen top-level fields', () => {
  const tmp = tmpProject('agentic-esf-');

  const out = runCli(tmp, ['requirements', '--request', 'Add device registration']);
  assertEnvelopeShape(out);

  assert.deepEqual(
    Object.keys(out).sort(),
    ['data', 'errors', 'instructions', 'state', 'step', 'warnings', 'workflow']
  );

  // Fresh init envelope: the empty draft reports semantic_complete false.
  assert.equal(out.data.semantic_complete, false);
});
