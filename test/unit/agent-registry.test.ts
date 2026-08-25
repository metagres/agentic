import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  loadAgentRegistry,
  getAgentById,
} from '../../src/scripts/lib/agent-registry.ts';

function makeAgentsFixture(agents: Record<string, string>): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-agents-'));
  const agentsDir = path.join(tmp, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });

  for (const [file, content] of Object.entries(agents)) {
    fs.writeFileSync(path.join(agentsDir, file), content, 'utf8');
  }

  return tmp;
}

function validAgent(id: string, description: string, mode?: string): string {
  const lines = [
    'version: 1',
    `id: ${id}`,
    `description: ${description}`,
    'model: opencode-go/grok-4.5',
    'temperature: 0.2',
  ];
  if (mode !== undefined) {
    lines.push(`mode: ${mode}`);
  }
  lines.push(
    'permissions:',
    '  file_read: allow',
    '  search: allow',
    '  file_write: deny',
    '  shell: deny',
    '  subagent: deny',
    '  web: deny',
    '  question: deny',
    'system_prompt: You are a neutral agent.',
    ''
  );
  return lines.join('\n');
}

test('loadAgentRegistry discovers and parses valid agent definitions', () => {
  const tmp = makeAgentsFixture({
    'code-reviewer.yaml': validAgent('code-reviewer', 'Reviews code changes'),
    'task-planner.yaml': validAgent('task-planner', 'Plans implementation tasks'),
  });

  const registry = loadAgentRegistry(tmp, path.join(tmp, 'agents'));
  const ids = registry.map((a) => a.id).sort();
  assert.deepEqual(ids, ['code-reviewer', 'task-planner']);

  const reviewer = registry.find((a) => a.id === 'code-reviewer');
  assert.ok(reviewer);
  assert.equal(reviewer.description, 'Reviews code changes');
  assert.equal(reviewer.model, 'opencode-go/grok-4.5');
  assert.equal(reviewer.temperature, 0.2);
  assert.deepEqual(reviewer.permissions, {
    file_read: 'allow',
    search: 'allow',
    file_write: 'deny',
    shell: 'deny',
    subagent: 'deny',
    web: 'deny',
    question: 'deny',
  });
  assert.equal(reviewer.systemPrompt, 'You are a neutral agent.');
  assert.ok(reviewer.file.endsWith('code-reviewer.yaml'));
});

test('an invalid model enum value fails schema validation naming the file', () => {
  const tmp = makeAgentsFixture({
    'bad-model.yaml': [
      'version: 1',
      'id: bad-model',
      'description: Bad model',
      'model: opencode-go/nonexistent',
      'temperature: 0.2',
      'permissions:',
      '  file_read: allow',
      '  search: allow',
      '  file_write: deny',
      '  shell: deny',
      '  subagent: deny',
      '  web: deny',
      '  question: deny',
      'system_prompt: You are a neutral agent.',
      '',
    ].join('\n'),
  });

  assert.throws(() => loadAgentRegistry(tmp, path.join(tmp, 'agents')), /bad-model\.yaml/);
});

test('an omitted mode resolves to all', () => {
  const tmp = makeAgentsFixture({
    'code-reviewer.yaml': validAgent('code-reviewer', 'Reviews code changes'),
  });

  const registry = loadAgentRegistry(tmp, path.join(tmp, 'agents'));
  assert.equal(registry.length, 1);
  assert.equal(registry[0].mode, 'all');
});

test('explicit mode values subagent and primary parse through', () => {
  const tmp = makeAgentsFixture({
    'helper-agent.yaml': validAgent('helper-agent', 'Runs as a subagent', 'subagent'),
    'main-agent.yaml': validAgent('main-agent', 'Runs as primary', 'primary'),
  });

  const registry = loadAgentRegistry(tmp, path.join(tmp, 'agents'));
  assert.equal(registry.find((a) => a.id === 'helper-agent')?.mode, 'subagent');
  assert.equal(registry.find((a) => a.id === 'main-agent')?.mode, 'primary');
});

test('an unknown mode value fails schema validation naming the file', () => {
  const tmp = makeAgentsFixture({
    'sideways.yaml': validAgent('sideways', 'Sideways agent', 'sideways'),
  });

  assert.throws(() => loadAgentRegistry(tmp, path.join(tmp, 'agents')), /sideways\.yaml/);
});

test('permissions missing the question key fails schema validation naming the file', () => {
  const tmp = makeAgentsFixture({
    'no-question.yaml': [
      'version: 1',
      'id: no-question',
      'description: Missing question permission',
      'model: opencode-go/grok-4.5',
      'temperature: 0.2',
      'permissions:',
      '  file_read: allow',
      '  search: allow',
      '  file_write: deny',
      '  shell: deny',
      '  subagent: deny',
      '  web: deny',
      'system_prompt: You are a neutral agent.',
      '',
    ].join('\n'),
  });

  assert.throws(() => loadAgentRegistry(tmp, path.join(tmp, 'agents')), /no-question\.yaml/);
});

test('id not matching the filename stem is a hard error naming the file', () => {
  const tmp = makeAgentsFixture({
    'renamed.yaml': validAgent('original', 'Original agent'),
  });

  assert.throws(() => loadAgentRegistry(tmp, path.join(tmp, 'agents')), /renamed\.yaml/);
});

test('invalid YAML is a hard error naming the file', () => {
  const tmp = makeAgentsFixture({
    'broken.yaml': 'not: [valid',
  });

  assert.throws(() => loadAgentRegistry(tmp, path.join(tmp, 'agents')), /broken\.yaml/);
});

test('a missing agents directory yields an empty registry without throwing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-agents-'));

  assert.deepEqual(loadAgentRegistry(tmp, path.join(tmp, 'agents')), []);
});

test('an empty agents directory yields an empty registry without throwing', () => {
  const tmp = makeAgentsFixture({});

  assert.deepEqual(loadAgentRegistry(tmp, path.join(tmp, 'agents')), []);
});

test('getAgentById resolves a known id and returns null for unknown ids', () => {
  const tmp = makeAgentsFixture({
    'code-reviewer.yaml': validAgent('code-reviewer', 'Reviews code changes'),
  });
  const agentsDir = path.join(tmp, 'agents');

  const found = getAgentById(tmp, 'code-reviewer', agentsDir);
  assert.ok(found);
  assert.equal(found.id, 'code-reviewer');

  assert.equal(getAgentById(tmp, 'does-not-exist', agentsDir), null);
});
