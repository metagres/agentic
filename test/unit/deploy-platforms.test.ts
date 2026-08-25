import test from 'node:test';
import assert from 'node:assert/strict';

import type { AgentRecord } from '../../src/scripts/lib/agent-registry.ts';
import {
  getRenderer,
  listPlatforms,
} from '../../src/scripts/lib/deploy/platforms/index.ts';
import { parseYamlString } from '../../src/scripts/lib/yaml-io.ts';

// --- Fixture ----------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a stage reviewer.',
  'Treat every artifact as guilty until proven correct.',
].join('\n');

/** Realistic AgentRecord: model is passed through verbatim, temperature is a
 *  number, mode is the registry-normalized default ('all'), and all seven
 *  neutral permission keys are present across all three levels
 *  (allow / ask / deny). */
function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 'stage-reviewer',
    file: '/repo/src/agents/stage-reviewer.yaml',
    description: 'Adversarially verifies development artifacts before approval.',
    model: 'opencode-go/kimi-k3',
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

  // file_write allow -> edit/write/apply_patch all "allow"
  assert.deepEqual(frontmatter.permission, {
    read: 'allow',
    list: 'allow',
    glob: 'allow',
    grep: 'allow',
    edit: 'allow',
    write: 'allow',
    apply_patch: 'allow',
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

test('the system prompt is preserved verbatim as the body', () => {
  const agent = makeAgent();
  for (const version of [1, 2]) {
    const rendered = getRenderer('opencode', version).renderAgent(agent);
    const { body } = parseRendered(rendered.content);
    // The file terminates with a trailing newline; the prompt itself is byte-
    // for-byte the body content.
    assert.equal(body, `${SYSTEM_PROMPT}\n`);
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
