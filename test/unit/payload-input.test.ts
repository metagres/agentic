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

function seedChange(tmp: string): string {
  assert.equal(runCli(tmp, ['init', '--change', 'add-device-registration']).state, 'ok');
  const out = runCli(tmp, ['requirements', '--change', 'add-device-registration']);
  assertEnvelopeShape(out);
  return path.basename(String(out.data.change_root));
}

test('update-artifact reads stdin with a bare flag, with "-", and from a file path that survives', () => {
  const tmp = tmpRepo('agentic-payload-');
  const changeDir = seedChange(tmp);
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);

  const patch = {
    functional_requirements: [
      {
        id: 'FR-001',
        description:
          'When a device registers, the system shall persist the registration record.',
        acceptance_criteria: [
          {
            id: 'AC-001',
            statement:
              'Given an unregistered device, When it registers, Then a registration record is persisted.',
            category: 'happy',
          },
        ],
      },
    ],
  };

  // Bare flag: stdin.
  let out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(patch)
  );
  assertEnvelopeShape(out);
  assert.equal(out.errors.length, 0, JSON.stringify(out.errors));
  let saved = readYaml(path.join(changeRoot, 'requirements.yaml')) as Record<string, unknown>;
  assert.match(String((saved.functional_requirements as { description: string }[])[0].description), /persist the registration record|registration record is persisted|registration record/);

  // Explicit '-' behaves identically to the bare flag.
  out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact', '-'],
    JSON.stringify(patch)
  );
  assertEnvelopeShape(out);
  assert.equal(out.errors.length, 0, JSON.stringify(out.errors));

  // File path: same merge, file untouched afterwards.
  const scratch = path.join(tmp, '.tmp', 'sdlc');
  fs.mkdirSync(scratch, { recursive: true });
  const payloadFile = path.join(scratch, `req-${Date.now()}-$$.yaml`);
  fs.writeFileSync(payloadFile, JSON.stringify(patch), 'utf8');
  const before = fs.readFileSync(payloadFile, 'utf8');

  out = runCli(tmp, [
    'requirements',
    '--change',
    changeDir,
    '--update-artifact',
    payloadFile,
  ]);
  assertEnvelopeShape(out);
  assert.equal(out.errors.length, 0, JSON.stringify(out.errors));
  saved = readYaml(path.join(changeRoot, 'requirements.yaml')) as Record<string, unknown>;
  const frs = saved.functional_requirements as { id: string; description: string }[];
  assert.equal(frs.length, 1);
  assert.match(frs[0].description, /registration record/);

  assert.ok(fs.existsSync(payloadFile), 'the CLI must never delete the input file');
  assert.equal(fs.readFileSync(payloadFile, 'utf8'), before, 'the CLI must never modify the input file');
});

test('append-delta reads the payload from a file path with identical validation', () => {
  const tmp = tmpRepo('agentic-payload-');
  const changeDir = seedChange(tmp);
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);

  const scratch = path.join(tmp, '.tmp', 'sdlc');
  fs.mkdirSync(scratch, { recursive: true });
  const deltaFile = path.join(scratch, `delta-${Date.now()}-$$.yaml`);
  fs.writeFileSync(
    deltaFile,
    [
      '- target_doc: docs/current/architecture.md',
      "  change: Add",
      '  reason: Describe the device registration flow added by this change.',
    ].join('\n'),
    'utf8'
  );

  const out = runCli(tmp, [
    'requirements',
    '--change',
    changeDir,
    '--append-delta',
    deltaFile,
  ]);
  assertEnvelopeShape(out);
  assert.equal(out.errors.length, 0, JSON.stringify(out.errors));

  const saved = readYaml(path.join(changeRoot, 'requirements.yaml')) as {
    delta: Record<string, unknown>[];
  };
  assert.equal(saved.delta.length, 1);
  assert.equal(saved.delta[0].target_doc, 'docs/current/architecture.md');
  assert.ok(fs.existsSync(deltaFile), 'the delta payload file must survive');
});

test('a missing payload file and empty stdin are refused naming the flag', () => {
  const tmp = tmpRepo('agentic-payload-');
  const changeDir = seedChange(tmp);

  let out = runCli(tmp, [
    'requirements',
    '--change',
    changeDir,
    '--update-artifact',
    path.join(tmp, '.tmp', 'sdlc', 'missing.yaml'),
  ]);
  assertEnvelopeShape(out);
  assert.equal(out.state, 'blocked');
  assert.match(String(out.errors[0].message), /--update-artifact/);

  out = runCli(tmp, ['requirements', '--change', changeDir, '--update-artifact'], '');
  assertEnvelopeShape(out);
  assert.equal(out.state, 'blocked');
  assert.match(String(out.errors[0].message), /--update-artifact/);

  out = runCli(tmp, ['requirements', '--change', changeDir, '--append-delta'], '');
  assertEnvelopeShape(out);
  assert.equal(out.state, 'blocked');
  assert.match(String(out.errors[0].message), /--append-delta/);
});

test('object arrays merge by id: matching entries update in place and new ids append', () => {
  const tmp = tmpRepo('agentic-merge-');
  const changeDir = seedChange(tmp);
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);

  // The template FR-001 exists; update it in place and append FR-002/FR-003.
  const input = {
    functional_requirements: [
      {
        id: 'FR-001',
        description:
          'When a device registers, the system shall persist the registration record.',
        acceptance_criteria: [
          {
            id: 'AC-001',
            statement:
              'Given an unregistered device, When it registers, Then a registration record is persisted.',
            category: 'happy',
          },
        ],
      },
      {
        id: 'FR-002',
        description:
          'When a registration is deleted, the system shall remove the persisted record.',
        acceptance_criteria: [
          {
            id: 'AC-002',
            statement:
              'Given a registered device, When its registration is deleted, Then the record is removed.',
            category: 'happy',
          },
        ],
      },
    ],
  };

  const out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(input)
  );
  assertEnvelopeShape(out);
  assert.equal(out.errors.length, 0, JSON.stringify(out.errors));

  const saved = readYaml(path.join(changeRoot, 'requirements.yaml')) as {
    functional_requirements: { id: string; description: string }[];
  };
  const frs = saved.functional_requirements;
  assert.equal(frs.length, 2);
  assert.equal(frs[0].id, 'FR-001', 'matching entries keep their position');
  assert.match(frs[0].description, /persist the registration record/);
  assert.equal(frs[1].id, 'FR-002', 'new ids append at the end');
});

test('mixed and id-less lists replace wholesale, and metadata survives the merge', () => {
  const tmp = tmpRepo('agentic-merge-');
  const changeDir = seedChange(tmp);
  const changeRoot = path.join(tmp, 'docs', 'changes', changeDir);

  const before = readYaml(path.join(changeRoot, 'requirements.yaml')) as {
    metadata: Record<string, unknown>;
    assumptions: unknown[];
  };

  const input = {
    assumptions: ['A replacement assumption without ids.'],
    out_of_scope: ['Configuring the deploy destination.'],
  };

  const out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(input)
  );
  assertEnvelopeShape(out);
  assert.equal(out.errors.length, 0, JSON.stringify(out.errors));

  const saved = readYaml(path.join(changeRoot, 'requirements.yaml')) as {
    metadata: Record<string, unknown>;
    assumptions: string[];
  };
  assert.deepEqual(saved.assumptions, ['A replacement assumption without ids.']);
  assert.equal(saved.metadata.status, before.metadata.status);
  assert.equal(saved.metadata.created, before.metadata.created);
  assert.equal(saved.metadata.version, before.metadata.version);
});
