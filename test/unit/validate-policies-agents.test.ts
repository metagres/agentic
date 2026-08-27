import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkAgentModelFields,
  AGENT_MODEL_OVERRIDE_EMPTY,
  AGENT_MODEL_OUTSIDE_CATALOG,
} from '../../src/scripts/lib/agent-model-fields.ts';

const CATALOG = ['opencode/grok-4.5', 'opencode/kimi-k3'];

function descriptor(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 1,
    id: 'sample',
    description: 'Sample agent',
    model: 'opencode/kimi-k3',
    temperature: 0.2,
    permissions: { file_read: 'allow' },
    system_prompt: 'You are a neutral agent.',
    ...overrides,
  };
}

test('an empty model_override fails naming the file and the empty value', () => {
  const findings = checkAgentModelFields(descriptor({ model_override: '' }), 'agents/sample.yaml', CATALOG);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, AGENT_MODEL_OVERRIDE_EMPTY);
  assert.match(findings[0].finding, /agents\/sample\.yaml/);
  assert.match(findings[0].finding, /''/);
});

test('a model outside the catalog enum fails naming the file and the value', () => {
  const findings = checkAgentModelFields(
    descriptor({ model: 'opencode/model-that-was-removed' }),
    'agents/sample.yaml',
    CATALOG
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, AGENT_MODEL_OUTSIDE_CATALOG);
  assert.match(findings[0].finding, /agents\/sample\.yaml/);
  assert.match(findings[0].finding, /opencode\/model-that-was-removed/);
});

test('free-form non-empty overrides pass because model_override is not enum-checked', () => {
  const findings = checkAgentModelFields(
    descriptor({ model_override: 'anthropic/claude-opus' }),
    'agents/sample.yaml',
    CATALOG
  );

  assert.deepEqual(findings, []);
});

test('a descriptor with a catalog model and no override produces no findings', () => {
  const findings = checkAgentModelFields(descriptor({}), 'agents/sample.yaml', CATALOG);

  assert.deepEqual(findings, []);
});
