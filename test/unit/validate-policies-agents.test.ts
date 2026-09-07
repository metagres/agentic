import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  checkAgentModelFields,
  AGENT_MODEL_OVERRIDE_EMPTY,
  AGENT_MODEL_OUTSIDE_CATALOG,
} from '../../src/scripts/lib/agent-model-fields.ts';
import {
  OUTPUT_DISCIPLINE_FRAGMENT,
  findFragmentMarkers,
} from '../../src/scripts/lib/agent-output-discipline.ts';
import { readYaml } from '../../src/scripts/lib/yaml-io.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

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

// --- Unauthorized fragment-copy gate (AGENT_FRAGMENT_COPY, DEC-003) ----------

test('a descriptor embedding fragment text trips the marker detection that drives AGENT_FRAGMENT_COPY', () => {
  const embedding = descriptor({
    system_prompt: `You are a neutral agent.\n\n${OUTPUT_DISCIPLINE_FRAGMENT}`,
  });

  const markers = findFragmentMarkers(String(embedding.system_prompt));
  assert.ok(markers.length > 0, 'fragment text is detected');
  assert.ok(markers.includes('No preamble, acknowledgments, or self-introduction'));
});

test('a near-copy of a fragment line also trips the detection', () => {
  const markers = findFragmentMarkers(
    'Remember: never recap CLI envelope or tool output the user can already see.'
  );
  assert.deepEqual(markers, ['Never recap CLI envelope']);
});

test('the shipped agent roster is clean of fragment text (the gate passes)', () => {
  const agentsDir = path.join(root, 'src', 'agents');
  const files = fs.readdirSync(agentsDir).filter((name) => name.endsWith('.yaml'));
  assert.ok(files.length > 0, 'the roster is non-empty');

  for (const name of files) {
    const doc = readYaml(path.join(agentsDir, name)) as Record<string, unknown>;
    const markers = findFragmentMarkers(String(doc.system_prompt || ''));
    assert.deepEqual(markers, [], `${name} carries no fragment text`);
  }
});

test('validate-policies passes the clean roster with no AGENT_FRAGMENT_COPY findings', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'bin', 'validate-policies.ts')], {
    encoding: 'utf8',
  });

  assert.equal(res.status, 0, `validate-policies exits 0:\n${res.stdout}\n${res.stderr}`);
  assert.ok(!res.stdout.includes('AGENT_FRAGMENT_COPY'), 'no fragment-copy findings');
});
