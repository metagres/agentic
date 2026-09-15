import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import { runCli, type CliIo } from '../src/cli.ts';
import { makeTempDir } from './helpers.ts';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

interface Collectors {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
}

function collect(): Collectors {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (t) => out.push(t), err: (t) => err.push(t) },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

function writeJson(dir: string, name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

test('list prints every supported check with its description', () => {
  const { io, stdout } = collect();
  assert.equal(runCli(['list'], io), 0);
  const text = stdout();
  for (const name of ['unique-ids', 'ref-exists', 'ref-covers', 'forbidden-words', 'dependency-acyclic']) {
    assert.ok(text.includes(name), `list output must include ${name}`);
  }
});

test('checks <name> --help prints the parameter list', () => {
  const { io, stdout } = collect();
  assert.equal(runCli(['unique-ids', '--help'], io), 0);
  const text = stdout();
  for (const param of ['arrays', 'unions', 'id_field']) {
    assert.ok(text.includes(param), `help output must mention ${param}`);
  }
  assert.ok(text.includes('required'));
  assert.ok(text.includes('optional'));
});

test('help <name> behaves like <name> --help', () => {
  const { io, stdout } = collect();
  assert.equal(runCli(['help', 'forbidden-words'], io), 0);
  assert.ok(stdout().includes('fields'));
});

test('no arguments prints usage and exits 0', () => {
  const { io, stdout } = collect();
  assert.equal(runCli([], io), 0);
  assert.ok(stdout().includes('Usage: checks'));
});

test('unknown check exits 2 and names the supported checks', () => {
  const { io, stderr } = collect();
  assert.equal(runCli(['nope', '--artifact', 'x.json'], io), 2);
  assert.ok(stderr().includes("Unknown check 'nope'"));
  assert.ok(stderr().includes('unique-ids'));
});

test('run fires a check on an artifact file: findings exit 1', () => {
  const dir = makeTempDir('checks-cli-');
  const artifact = writeJson(dir, 'artifact.json', { items: [{ id: 'A' }, { id: 'A' }] });

  const { io, stdout } = collect();
  const code = runCli(['unique-ids', '--artifact', artifact, '--params', '{"arrays":["items"]}'], io);

  assert.equal(code, 1);
  const findings = JSON.parse(stdout());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'unique-ids');
});

test('run exits 0 on a clean artifact', () => {
  const dir = makeTempDir('checks-cli-');
  const artifact = writeJson(dir, 'artifact.json', { items: [{ id: 'A' }] });

  const { io, stdout } = collect();
  const code = runCli(['unique-ids', '--artifact', artifact, '--params', '{"arrays":["items"]}'], io);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout()), []);
});

test('run accepts params from a params file', () => {
  const dir = makeTempDir('checks-cli-');
  const artifact = writeJson(dir, 'artifact.json', { items: [{ id: 'A' }, { id: 'A' }] });
  const paramsFile = writeJson(dir, 'params.json', { arrays: ['items'] });

  const { io, stdout } = collect();
  const code = runCli(['unique-ids', '--artifact', artifact, '--params-file', paramsFile], io);

  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout()).length, 1);
});

test('run passes named secondary documents through --artifacts', () => {
  const dir = makeTempDir('checks-cli-');
  const artifact = writeJson(dir, 'artifact.json', {
    components: [{ id: 'C1', satisfies: ['REQ-1'] }],
  });

  const { io, stdout } = collect();
  const code = runCli(
    [
      'ref-covers',
      '--artifact',
      artifact,
      '--params',
      '{"from":{"array":"components","field":"satisfies"},"to":{"arrays":["requirements"],"field":"id"}}',
      '--artifacts',
      '{"target":{"requirements":[{"id":"REQ-1"},{"id":"REQ-2"}]}}',
    ],
    io
  );

  assert.equal(code, 1);
  const findings = JSON.parse(stdout());
  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('REQ-2'));
});

test('run rejects a missing artifact file with exit 2', () => {
  const { io, stderr } = collect();
  const code = runCli(
    ['unique-ids', '--artifact', '/nonexistent/artifact.json', '--params', '{"arrays":["items"]}'],
    io
  );

  assert.equal(code, 2);
  assert.ok(stderr().includes('Unable to read file'));
});

test('run accepts --basePath for file references', () => {
  const dir = makeTempDir('checks-cli-');
  const artifact = writeJson(dir, 'artifact.json', {
    tasks: [{ id: 'T1', requires: ['REQ-1'] }],
  });
  writeJson(dir, 'target.json', { requirements: [{ id: 'REQ-1' }] });

  const { io, stdout } = collect();
  const code = runCli(
    [
      'ref-exists',
      '--artifact',
      artifact,
      '--basePath',
      dir,
      '--params',
      '{"from":{"array":"tasks","field":"requires"},"to":{"file":"target.json","arrays":["requirements"],"field":"id"}}',
    ],
    io
  );

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout()), []);
});

test('run rejects invalid JSON in --params with exit 2', () => {
  const dir = makeTempDir('checks-cli-');
  const artifact = writeJson(dir, 'artifact.json', {});

  const { io, stderr } = collect();
  const code = runCli(['unique-ids', '--artifact', artifact, '--params', '{nope'], io);

  assert.equal(code, 2);
  assert.ok(stderr().includes('Invalid JSON from --params'));
});

test('run rejects a non-object artifact with exit 2', () => {
  const dir = makeTempDir('checks-cli-');
  const artifact = writeJson(dir, 'array.json', [1, 2]);

  const { io, stderr } = collect();
  const code = runCli(['unique-ids', '--artifact', artifact, '--params', '{"arrays":[]}'], io);

  assert.equal(code, 2);
  assert.ok(stderr().includes('artifact must be a JSON object'));
});

test('run reports missing required parameters with exit 2', () => {
  const dir = makeTempDir('checks-cli-');
  const artifact = writeJson(dir, 'artifact.json', {});

  const { io, stderr } = collect();
  const code = runCli(['unique-ids', '--artifact', artifact], io);

  assert.equal(code, 2);
  assert.ok(stderr().includes('missing required parameter(s): arrays'));
});

test('run without --artifact exits 2', () => {
  const { io, stderr } = collect();
  assert.equal(runCli(['unique-ids'], io), 2);
  assert.ok(stderr().includes('--artifact'));
});

test('stdin artifact via "-" works end to end', () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, 'unique-ids', '--artifact', '-', '--params', '{"arrays":["items"]}'],
    {
      input: JSON.stringify({ items: [{ id: 'A' }, { id: 'A' }] }),
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 1);
  const findings = JSON.parse(result.stdout);
  assert.equal(findings.length, 1);
});
