import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWithSchema } from '../../src/scripts/lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

test('valid CLI envelope passes schema', () => {
  const envelope = {
    workflow: 'cli',
    step: 'help',
    state: 'ok',
    instructions: '',
    data: {},
    errors: [],
    warnings: [],
  };

  const findings = validateWithSchema(
    envelope,
    'cli-envelope.schema.yaml',
    root
  );

  assert.deepEqual(findings, []);
});

test('CLI envelope with extra top-level field fails schema', () => {
  const envelope = {
    workflow: 'cli',
    step: 'help',
    state: 'ok',
    instructions: '',
    data: {},
    errors: [],
    warnings: [],
    next_action: 'not-allowed',
  };

  const findings = validateWithSchema(
    envelope,
    'cli-envelope.schema.yaml',
    root
  );

  assert.ok(findings.length > 0);
});

test('invalid CLI envelope state fails schema', () => {
  const envelope = {
    workflow: 'cli',
    step: 'help',
    state: 'wrong',
    instructions: '',
    data: {},
    errors: [],
    warnings: [],
  };

  const findings = validateWithSchema(
    envelope,
    'cli-envelope.schema.yaml',
    root
  );

  assert.ok(findings.length > 0);
});
