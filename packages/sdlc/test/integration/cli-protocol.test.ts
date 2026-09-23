// P-02 contract tests: exit codes and JSON shape over the real entry point.
// Spawns the canonical source entry with Node type-stripping (no build needed).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const PACKAGE_ROOT = new URL('../..', import.meta.url);
const ENTRY = new URL('../../src/cli/sdlc-cli.ts', import.meta.url);
const PACKAGE_JSON = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): RunResult {
  const result = spawnSync(process.execPath, [ENTRY.pathname, ...args], {
    cwd: PACKAGE_ROOT.pathname,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseStdoutJson(stdout: string): unknown {
  return JSON.parse(stdout);
}

function parseStderrEnvelope(stderr: string): { error: { code: string; message: string; details: object } } {
  const parsed = JSON.parse(stderr) as {
    error?: { code?: unknown; message?: unknown; details?: unknown };
  };
  assert.ok(parsed && typeof parsed === 'object', 'stderr must be a JSON object');
  assert.ok(parsed.error && typeof parsed.error === 'object', 'stderr must carry error envelope');
  assert.equal(typeof parsed.error.code, 'string', 'envelope code must be a string');
  assert.equal(typeof parsed.error.message, 'string', 'envelope message must be a string');
  assert.ok(
    parsed.error.details !== null && typeof parsed.error.details === 'object',
    'envelope details must be an object',
  );
  return parsed as { error: { code: string; message: string; details: object } };
}

describe('P-02 CLI protocol contract', () => {
  it('--version outputs JSON with the package version, exit 0', () => {
    const result = runCli(['--version']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const payload = parseStdoutJson(result.stdout) as { version?: unknown };
    assert.equal(payload.version, PACKAGE_JSON.version);
  });

  it('--version --human prints only the version string', () => {
    const result = runCli(['--version', '--human']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.trim(), PACKAGE_JSON.version);
  });

  it('--help outputs a JSON descriptor listing every command', () => {
    const result = runCli(['--help']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const payload = parseStdoutJson(result.stdout) as {
      commands?: Array<{ name?: unknown; description?: unknown; usage?: unknown; example?: unknown }>;
    };
    assert.ok(Array.isArray(payload.commands), 'help JSON must list commands');
    const names = payload.commands.map((command) => command.name);
    assert.ok(names.includes('--version'), 'help must describe --version');
    assert.ok(names.includes('--help'), 'help must describe --help');
    for (const command of payload.commands) {
      assert.equal(typeof command.name, 'string');
      assert.equal(typeof command.description, 'string');
      assert.equal(typeof command.usage, 'string');
      assert.equal(typeof command.example, 'string');
    }
  });

  it('--help --human prints a readable command list', () => {
    const result = runCli(['--help', '--human']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /--version/);
    assert.match(result.stdout, /--help/);
    assert.throws(() => JSON.parse(result.stdout), 'human help must not be JSON');
  });

  it('unknown command fails with UNKNOWN_COMMAND envelope on stderr, exit 2, silent stdout', () => {
    const result = runCli(['frobnicate']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    const envelope = parseStderrEnvelope(result.stderr);
    assert.equal(envelope.error.code, 'UNKNOWN_COMMAND');
  });

  it('bad flag fails with INVALID_INVOCATION envelope, exit 2, silent stdout', () => {
    const result = runCli(['--bogus-flag']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    const envelope = parseStderrEnvelope(result.stderr);
    assert.equal(envelope.error.code, 'INVALID_INVOCATION');
  });

  it('internal error hook fails with INTERNAL_ERROR envelope, exit 9', () => {
    const result = runCli(['--test-internal-error']);
    assert.equal(result.status, 9);
    assert.equal(result.stdout, '');
    const envelope = parseStderrEnvelope(result.stderr);
    assert.equal(envelope.error.code, 'INTERNAL_ERROR');
  });

  it('meta-flags win over unrecognized positionals, in any order', () => {
    for (const args of [['frobnicate', '--version'], ['--version', 'frobnicate']]) {
      const result = runCli(args);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      const payload = parseStdoutJson(result.stdout) as { version?: unknown };
      assert.equal(payload.version, PACKAGE_JSON.version);
    }
  });

  it('registry order is precedence: the first matching command wins', () => {
    const result = runCli(['--version', '--help']);
    assert.equal(result.status, 0);
    const payload = parseStdoutJson(result.stdout) as { version?: unknown };
    assert.equal(payload.version, PACKAGE_JSON.version);
  });

  it('bare invocation lists commands as JSON, exit 0', () => {
    const result = runCli([]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const payload = parseStdoutJson(result.stdout) as { commands?: unknown };
    assert.ok(Array.isArray(payload.commands));
  });

  it('flags-only invocation without a command is invalid', () => {
    const result = runCli(['--human']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    const envelope = parseStderrEnvelope(result.stderr);
    assert.equal(envelope.error.code, 'INVALID_INVOCATION');
  });

  it('equals-form flags are rejected under the exact-match grammar', () => {
    const result = runCli(['--version=x']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    const envelope = parseStderrEnvelope(result.stderr);
    assert.equal(envelope.error.code, 'INVALID_INVOCATION');
  });

  it('never exits 1 across the skeleton surface', () => {
    for (const args of [
      ['--version'],
      ['--help'],
      [],
      ['frobnicate'],
      ['--bogus-flag'],
      ['--test-internal-error'],
      ['--human'],
      ['--version=x'],
      ['frobnicate', '--version'],
    ]) {
      assert.notEqual(runCli(args).status, 1, `exit 1 is reserved (${args.join(' ')})`);
    }
  });
});
