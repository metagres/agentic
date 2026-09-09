import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentRecord } from '../../src/scripts/lib/agent-registry.ts';
import { loadAgentRegistry } from '../../src/scripts/lib/agent-registry.ts';
import {
  getRenderer,
  listPlatforms,
} from '../../src/scripts/lib/deploy/platforms/index.ts';
import { parseYamlString } from '../../src/scripts/lib/yaml-io.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// --- Fixture ----------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a stage reviewer.',
  'Treat every artifact as guilty until proven correct.',
].join('\n');

/** Realistic AgentRecord: model is passed through verbatim, temperature is a
 *  number, mode is the registry-normalized default ('all'), and all seven
 *  neutral permission keys are present across all three levels
 *  (allow / ask / deny). By default no override is set (modelOverride null,
 *  effectiveModel equal to model). */
function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 'stage-reviewer',
    file: '/repo/src/agents/stage-reviewer.yaml',
    description: 'Adversarially verifies development artifacts before approval.',
    model: 'opencode-go/kimi-k3',
    modelOverride: null,
    effectiveModel: 'opencode-go/kimi-k3',
    temperature: 0.3,
    mode: 'all',
    permissions: {
      file_read: 'allow',
      search: 'allow',
      file_write: 'allow',
      shell: 'ask',
      subagent: 'deny',
      web: 'deny',
      question: 'allow',
    },
    systemPrompt: SYSTEM_PROMPT,
    ...overrides,
  };
}

/** An agent whose base fixture permissions carry `question` at `level`. */
function agentWithQuestion(level: 'allow' | 'ask' | 'deny'): AgentRecord {
  return makeAgent({ permissions: { ...makeAgent().permissions, question: level } });
}

/** An agent whose base fixture permissions carry `file_write` at `level`. */
function agentWithFileWrite(level: 'allow' | 'ask' | 'deny'): AgentRecord {
  return makeAgent({ permissions: { ...makeAgent().permissions, file_write: level } });
}

/** The path-scoped permission object the v2 renderer must emit for a
 *  non-denied file-write target: the neutral level as the catch-all (first,
 *  because OpenCode resolves object rules last-match-wins) followed by the
 *  protected change-artifact deny patterns. */
function protectedWriteRule(level: 'allow' | 'ask'): Record<string, string> {
  return {
    '*': level,
    '**/docs/changes/**': 'deny',
    'docs/changes/**': 'deny',
  };
}

/** Splits rendered content into its parsed YAML frontmatter and the body that
 *  follows the closing `---`. */
function parseRendered(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const lines = content.split('\n');
  assert.equal(lines[0], '---');
  const closeIdx = lines.indexOf('---', 1);
  assert.ok(closeIdx > 1, 'closing frontmatter marker found');
  const frontmatter = parseYamlString(
    lines.slice(1, closeIdx).join('\n'),
    'rendered-agent-frontmatter'
  ) as Record<string, unknown>;
  // lines[closeIdx + 1] is the blank line separating frontmatter and body.
  const body = lines.slice(closeIdx + 2).join('\n');
  return { frontmatter, body };
}

// --- v2 renderer ------------------------------------------------------------

test('v2 renderer emits agents/<id>.md with frontmatter fields carried through', () => {
  const agent = makeAgent();
  const rendered = getRenderer('opencode').renderAgent(agent);

  assert.equal(rendered.path, 'agents/stage-reviewer.md');

  const { frontmatter } = parseRendered(rendered.content);
  assert.equal(frontmatter.description, agent.description);
  assert.equal(frontmatter.mode, 'all');
  assert.equal(frontmatter.model, 'opencode-go/kimi-k3');
  assert.equal(frontmatter.temperature, 0.3);
});

test('v2 permission translation covers all six neutral keys and all three levels', () => {
  const agent = makeAgent();
  const rendered = getRenderer('opencode').renderAgent(agent);
  const { frontmatter } = parseRendered(rendered.content);

  // file_write allow -> edit/write/apply_patch carry the neutral level for
  // every path (* first) plus the protected change-artifact deny patterns.
  assert.deepEqual(frontmatter.permission, {
    read: 'allow',
    list: 'allow',
    glob: 'allow',
    grep: 'allow',
    edit: protectedWriteRule('allow'),
    write: protectedWriteRule('allow'),
    apply_patch: protectedWriteRule('allow'),
    bash: 'ask',
    task: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    question: 'allow',
  });

  // web deny -> webfetch/websearch "deny"
  const permission = frontmatter.permission as Record<string, string>;
  assert.equal(permission.webfetch, 'deny');
  assert.equal(permission.websearch, 'deny');
  // an ask level passes through as "ask"
  assert.equal(permission.bash, 'ask');
});

test('v2 file-write rules deny the change-artifact directory with the catch-all first', () => {
  const rendered = getRenderer('opencode').renderAgent(agentWithFileWrite('allow'));
  const { frontmatter } = parseRendered(rendered.content);
  const permission = frontmatter.permission as Record<string, unknown>;

  const edit = permission.edit as Record<string, string>;
  // Key order matters at the platform: '*' must precede the protected
  // patterns (last-match-wins resolution).
  assert.deepEqual(Object.keys(edit), ['*', '**/docs/changes/**', 'docs/changes/**']);
  assert.equal(edit['*'], 'allow');
  assert.equal(edit['**/docs/changes/**'], 'deny');
  assert.equal(edit['docs/changes/**'], 'deny');
});

test('v2 file-write ask keeps ask for other paths and denies change artifacts', () => {
  const rendered = getRenderer('opencode').renderAgent(agentWithFileWrite('ask'));
  const { frontmatter } = parseRendered(rendered.content);
  const permission = frontmatter.permission as Record<string, unknown>;
  assert.deepEqual(permission.write, protectedWriteRule('ask'));
});

test('v2 file-write deny stays a flat string (nothing writable either way)', () => {
  const rendered = getRenderer('opencode').renderAgent(agentWithFileWrite('deny'));
  const { frontmatter } = parseRendered(rendered.content);
  const permission = frontmatter.permission as Record<string, unknown>;
  assert.equal(permission.edit, 'deny');
  assert.equal(permission.write, 'deny');
  assert.equal(permission.apply_patch, 'deny');
});

test('v2 question translation emits the neutral level verbatim', () => {
  for (const level of ['allow', 'ask', 'deny'] as const) {
    const rendered = getRenderer('opencode').renderAgent(agentWithQuestion(level));
    const { frontmatter } = parseRendered(rendered.content);
    const permission = frontmatter.permission as Record<string, string>;
    assert.equal(permission.question, level, `question level ${level}`);
  }
});

// --- v1 renderer ------------------------------------------------------------

test('v1 renderer emits the legacy tools map (true/false, ask omitted)', () => {
  const agent = makeAgent();
  const rendered = getRenderer('opencode', 1).renderAgent(agent);

  assert.equal(rendered.path, 'agents/stage-reviewer.md');

  const { frontmatter } = parseRendered(rendered.content);
  assert.equal(frontmatter.description, agent.description);
  assert.equal(frontmatter.mode, 'all');
  assert.equal(frontmatter.model, 'opencode-go/kimi-k3');
  assert.equal(frontmatter.temperature, 0.3);

  assert.deepEqual(frontmatter.tools, {
    read: true,
    list: true,
    glob: true,
    grep: true,
    edit: true,
    write: true,
    apply_patch: true,
    task: false,
    webfetch: false,
    websearch: false,
    question: true,
  });

  // 'ask' levels are omitted from the legacy tools map.
  const tools = frontmatter.tools as Record<string, unknown>;
  assert.equal('bash' in tools, false);
});

test('v1 question maps into the tools map (true/false, ask omitted)', () => {
  // allow -> question: true
  const allowRendered = getRenderer('opencode', 1).renderAgent(agentWithQuestion('allow'));
  const { frontmatter: allowFm } = parseRendered(allowRendered.content);
  const allowTools = allowFm.tools as Record<string, unknown>;
  assert.equal(allowTools.question, true);

  // deny -> question: false
  const denyRendered = getRenderer('opencode', 1).renderAgent(agentWithQuestion('deny'));
  const { frontmatter: denyFm } = parseRendered(denyRendered.content);
  const denyTools = denyFm.tools as Record<string, unknown>;
  assert.equal(denyTools.question, false);

  // ask -> omitted
  const askRendered = getRenderer('opencode', 1).renderAgent(agentWithQuestion('ask'));
  const { frontmatter: askFm } = parseRendered(askRendered.content);
  const askTools = askFm.tools as Record<string, unknown>;
  assert.equal('question' in askTools, false);
});

// --- effective model (DEC-004) ----------------------------------------------

test('v2 renderer writes the effective model into frontmatter when an override is set', () => {
  const agent = makeAgent({
    modelOverride: 'anthropic/claude-opus',
    effectiveModel: 'anthropic/claude-opus',
  });
  const rendered = getRenderer('opencode').renderAgent(agent);
  const { frontmatter } = parseRendered(rendered.content);

  assert.equal(frontmatter.model, 'anthropic/claude-opus');
});

test('v1 renderer writes the effective model into frontmatter when an override is set', () => {
  const agent = makeAgent({
    modelOverride: 'gpt-5',
    effectiveModel: 'gpt-5',
  });
  const rendered = getRenderer('opencode', 1).renderAgent(agent);
  const { frontmatter } = parseRendered(rendered.content);

  assert.equal(frontmatter.model, 'gpt-5');
});

test('without an override the rendered model equals the recommendation', () => {
  for (const version of [1, 2]) {
    const agent = makeAgent();
    assert.equal(agent.effectiveModel, agent.model);
    const rendered = getRenderer('opencode', version).renderAgent(agent);
    const { frontmatter } = parseRendered(rendered.content);
    assert.equal(frontmatter.model, 'opencode-go/kimi-k3', `v${version} recommendation`);
  }
});

// --- mode -------------------------------------------------------------------

test('mode is carried through verbatim (all and subagent)', () => {
  for (const version of [1, 2]) {
    const renderedAll = getRenderer('opencode', version).renderAgent(makeAgent());
    const { frontmatter: allFm } = parseRendered(renderedAll.content);
    assert.equal(allFm.mode, 'all', `v${version} all mode`);

    const renderedSub = getRenderer('opencode', version).renderAgent(
      makeAgent({ mode: 'subagent' })
    );
    const { frontmatter: subFm } = parseRendered(renderedSub.content);
    assert.equal(subFm.mode, 'subagent', `v${version} subagent mode`);
  }
});

// --- body -------------------------------------------------------------------

test('the agent system prompt is the body verbatim', () => {
  const agent = makeAgent();
  for (const version of [1, 2]) {
    const rendered = getRenderer('opencode', version).renderAgent(agent);
    const { body } = parseRendered(rendered.content);
    // The file terminates with a trailing newline; the system prompt is
    // byte-for-byte the body content.
    assert.equal(body, `${agent.systemPrompt}\n`);
  }
});

// --- roster body emission ----------------------------------------------------

test('every roster agent renders its system prompt as the body across both renderer versions', () => {
  const roster = loadAgentRegistry(repoRoot);
  assert.equal(roster.length, 6, 'the six-agent roster loads');

  for (const agent of roster) {
    for (const version of [1, 2]) {
      const rendered = getRenderer('opencode', version).renderAgent(agent);
      const { frontmatter, body } = parseRendered(rendered.content);

      assert.equal(
        body,
        `${agent.systemPrompt}\n`,
        `v${version} body of '${agent.id}' is the system prompt verbatim`
      );

      // Frontmatter fields are unchanged.
      assert.equal(frontmatter.description, agent.description, `v${version} ${agent.id} description`);
      assert.equal(frontmatter.mode, agent.mode, `v${version} ${agent.id} mode`);
      assert.equal(frontmatter.model, agent.effectiveModel, `v${version} ${agent.id} model`);
      assert.equal(frontmatter.temperature, agent.temperature, `v${version} ${agent.id} temperature`);
    }
  }
});

test('roster agents across all modes (subagent, primary, all) render the body with no exemption', () => {
  const roster = loadAgentRegistry(repoRoot);
  assert.equal(roster.length, 6, 'the six-agent roster loads');

  // The shipped roster resolves to mode 'all' (no explicit mode field); the
  // remaining modes are covered with synthetic records so every mode value is
  // exercised with no agent exempt.
  const acrossModes: AgentRecord[] = [
    ...roster,
    makeAgent({ id: 'subagent-agent', mode: 'subagent' }),
    makeAgent({ id: 'primary-agent', mode: 'primary' }),
  ];

  for (const agent of acrossModes) {
    const rendered = getRenderer('opencode').renderAgent(agent);
    const { body } = parseRendered(rendered.content);
    assert.equal(
      body,
      `${agent.systemPrompt}\n`,
      `'${agent.id}' (mode ${agent.mode}) renders the system prompt verbatim`
    );
  }
});

// --- registry resolution ----------------------------------------------------

test('getRenderer defaults to the newest version and resolves explicit versions', () => {
  assert.equal(getRenderer('opencode').version, 2);
  assert.equal(getRenderer('opencode', 'latest').version, 2);
  assert.equal(getRenderer('opencode', 2).version, 2);
  assert.equal(getRenderer('opencode', 1).version, 1);
});

test('getRenderer throws listing supported platforms for an unknown platform', () => {
  assert.throws(
    () => getRenderer('claude-code'),
    /Unknown platform 'claude-code'\. Supported: opencode \(versions: 1, 2\)\./
  );
});

test('getRenderer throws listing supported versions for an unknown version', () => {
  assert.throws(
    () => getRenderer('opencode', 7),
    /Unknown version '7' for platform 'opencode'\. Supported: 1, 2\./
  );
});

test('listPlatforms returns opencode with versions [1, 2]', () => {
  assert.deepEqual(listPlatforms(), [{ platform: 'opencode', versions: [1, 2] }]);
});
