import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { validateWithSchema } from '../../src/scripts/lib/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function tmpRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface RunResult {
  envelope: Record<string, any>;
  status: number;
}

function runCli(tmp: string, args: string[], input?: string): RunResult {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
  });
  assert.ok(res.stdout || res.stderr, `no output: ${args.join(' ')}`);
  const envelope = JSON.parse(res.stdout || res.stderr);
  return { envelope, status: res.status ?? 0 };
}

function assertEnvelopeShape(payload: Record<string, unknown>) {
  const findings = validateWithSchema(payload, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, []);
}

function seedRequirements(tmp: string, changeDir: string, status: string, version: string): string {
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);
  fs.mkdirSync(changeRoot, { recursive: true });
  const body = [
    'metadata:',
    '  id: REQ-001',
    '  title: Test requirements',
    '  stage: requirements',
    `  status: ${status}`,
    `  version: ${version}`,
    '  created: "2026-01-01"',
    '  updated: "2026-01-01"',
    '  request_summary: Seed request.',
    '  clarity: clear',
    '  assumptions_reviewed: true',
    '  delta_reviewed: true',
    'problem_statement: The seed problem statement.',
    'discovery_log: []',
    'assumptions: []',
    'functional_requirements: []',
    'non_functional_requirements: []',
    'out_of_scope: []',
    'failure_paths: []',
    'risks_and_dependencies: []',
    'delta: []',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(changeRoot, 'requirements.yaml'), body, 'utf8');
  return changeDir;
}

test('a typo mutation flag is refused with UNKNOWN_FLAG before any effect', () => {
  const tmp = tmpRepo('agentic-uf-');
  const changeDir = seedRequirements(tmp, 'typo', 'draft', '0.1.0');

  const { envelope, status } = runCli(tmp, [
    'requirements',
    '--change',
    changeDir,
    '--updat-artifact',
  ]);
  assertEnvelopeShape(envelope);
  assert.equal(envelope.state, 'blocked');
  assert.equal(envelope.errors[0].code, 'UNKNOWN_FLAG');
  assert.deepEqual(envelope.data.unknown_flags, ['--updat-artifact']);
  assert.match(String(envelope.instructions), /--help/);
  assert.equal(status, 2, 'the usage exit code is required');

  // Nothing was written: the artifact metadata is untouched.
  const saved = readYaml(path.join(tmp, 'docs', 'changes', changeDir, 'requirements.yaml')) as {
    metadata: Record<string, unknown>;
  };
  assert.equal(saved.metadata.updated, '2026-01-01');
});

test('the global --cwd flag is accepted on every command', () => {
  const tmp = tmpRepo('agentic-uf-');
  seedRequirements(tmp, 'cwd-ok', 'draft', '0.1.0');

  // Invoked from OUTSIDE the repo root with --cwd pointing at it.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-uf-out-'));
  const { envelope, status } = runCli(outside, [
    'status',
    '--change',
    'cwd-ok',
    '--cwd',
    tmp,
  ]);
  assertEnvelopeShape(envelope);
  assert.equal(status, 0);
  assert.equal(envelope.data.change_name, 'cwd-ok');
  assert.ok(['ok', 'in_progress', 'blocked', 'complete'].includes(envelope.state));

  const { envelope: lintEnvelope } = runCli(outside, [
    'requirements',
    '--change',
    'cwd-ok',
    '--lint',
    '--cwd',
    tmp,
  ]);
  assertEnvelopeShape(lintEnvelope);
  assert.equal(lintEnvelope.state, 'ok');
});

test('removed flags are refused by the vocabulary: bump-version, keep-status, next-ids', () => {
  const tmp = tmpRepo('agentic-uf-');
  const changeDir = seedRequirements(tmp, 'removed-flags', 'draft', '0.1.0');

  for (const flag of ['--bump-version', 'patch', '--keep-status', '--next-ids']) {
    // one flag per invocation would consume values; run the trio separately
  }

  for (const [flag, extra] of [
    ['--bump-version', ['patch']],
    ['--keep-status', []],
    ['--next-ids', []],
  ] as [string, string[]][]) {
    const { envelope } = runCli(tmp, [
      'requirements',
      '--change',
      changeDir,
      flag,
      ...extra,
    ]);
    assertEnvelopeShape(envelope);
    assert.equal(envelope.errors[0].code, 'UNKNOWN_FLAG', flag);
  }
});

test('finalize from rejected bumps the version patch with no bump flag', () => {
  const tmp = tmpRepo('agentic-uf-');
  const changeDir = seedRequirements(tmp, 'bump-patch', 'rejected', '0.1.0');

  const { envelope } = runCli(tmp, [
    'requirements',
    '--change',
    changeDir,
    '--finalize',
    '--confirm-semantic',
  ]);
  assertEnvelopeShape(envelope);
  assert.equal(envelope.errors.length, 0, JSON.stringify(envelope.errors));

  const saved = readYaml(path.join(tmp, 'docs', 'changes', changeDir, 'requirements.yaml')) as {
    metadata: Record<string, unknown>;
  };
  assert.equal(saved.metadata.version, '0.1.1');
  assert.equal(saved.metadata.status, 'ready-for-review');
});

test('the legacy review --target command is gone (UNKNOWN_COMMAND)', () => {
  const tmp = tmpRepo('agentic-uf-');
  const { envelope, status } = runCli(tmp, [
    'review',
    '--target',
    'requirements',
  ]);
  assertEnvelopeShape(envelope);
  assert.equal(envelope.errors[0].code, 'UNKNOWN_COMMAND');
  assert.equal(status, 2);
});

test('every command answers --help with a usage and flags map (AC-027, AC-029)', () => {
  const commands = [
    'requirements',
    'design',
    'planning',
    'implementation',
    'requirements-review',
    'design-review',
    'planning-review',
    'implementation-review',
    'knowledge-extraction',
    'changes',
    'status',
    'feedback',
    'doctor',
  ];

  for (const command of commands) {
    const { envelope } = runCli(tmpRepo('agentic-uf-'), [command, '--help']);
    assertEnvelopeShape(envelope);
    assert.equal(envelope.state, 'ok', command);
    assert.ok(Array.isArray(envelope.data.usage) && envelope.data.usage.length > 0, command);
    assert.ok(
      envelope.data.flags && typeof envelope.data.flags === 'object' && Object.keys(envelope.data.flags).length > 0,
      `${command}: flags map must be non-empty`
    );
    for (const field of ['workflow', 'step', 'state', 'instructions', 'data', 'errors', 'warnings']) {
      assert.ok(field in envelope, `${command}: top-level field ${field} present`);
    }
    assert.equal(Object.keys(envelope).length, 7, `${command}: seven frozen top-level fields`);
  }
});
