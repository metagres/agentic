/**
 * OpenCode agent renderer (TASK-009). Converts a neutral AgentRecord into the
 * OpenCode agent file format at `agents/<agent-id>.md`, and is the only module
 * allowed to encode OpenCode-specific knowledge.
 *
 * Two version variants are supported:
 *
 *   v2 — current format: a `permission` frontmatter map whose target tool keys
 *        (read, list, glob, grep, edit, write, apply_patch, bash, task,
 *        webfetch, websearch, question) carry the neutral level verbatim
 *        ('allow' | 'ask' | 'deny').
 *   v1 — legacy format: a `tools` frontmatter map over the same target keys
 *        with allow -> true, deny -> false, and ask omitted.
 *
 * The frontmatter follows the style of the generated SKILL.md (see
 * bin/deploy-to-agent.ts SKILL_TEMPLATE): `---`, `key: value` lines, closing
 * `---`, a blank line, then the body — the system prompt verbatim.
 */
import YAML from 'yaml';

import type { AgentRecord } from '../../agent-registry.ts';
import type { PermissionKey } from '../../agent-permissions.ts';
import type { AgentRenderer, RenderedAgent } from './index.ts';

/** Neutral permission keys rendered into OpenCode frontmatter: the six
 *  engine-level PermissionKeys plus 'question', which agent descriptors may
 *  declare for interactive questioning but which takes no part in stage-kind
 *  permission contracts. */
type RenderPermissionKey = PermissionKey | 'question';

/** Neutral permission key -> target OpenCode tool keys. The Record is keyed by
 *  every renderable neutral key (compile-time coverage); object iteration
 *  order is the emission order. */
const NEUTRAL_TO_TARGET: Record<RenderPermissionKey, readonly string[]> = {
  file_read: ['read', 'list'],
  search: ['glob', 'grep'],
  file_write: ['edit', 'write', 'apply_patch'],
  shell: ['bash'],
  subagent: ['task'],
  web: ['webfetch', 'websearch'],
  question: ['question'],
};

/**
 * Maps the agent's neutral permissions onto the OpenCode target tool keys.
 * Returns the v2 `permission` map (target -> neutral level) and the v1 `tools`
 * map (target -> boolean, 'ask' omitted). A missing neutral key defaults to
 * 'deny' (least privilege); the agent schema requires every key.
 */
function translatePermissions(agent: AgentRecord): {
  permission: Record<string, string>;
  tools: Record<string, boolean>;
} {
  const permission: Record<string, string> = {};
  const tools: Record<string, boolean> = {};

  for (const [neutralKey, targets] of Object.entries(NEUTRAL_TO_TARGET)) {
    const level = agent.permissions[neutralKey] ?? 'deny';
    for (const target of targets) {
      permission[target] = level;
      if (level === 'allow') tools[target] = true;
      else if (level === 'deny') tools[target] = false;
      // 'ask' is omitted from the legacy tools map.
    }
  }

  return { permission, tools };
}

/** Renders the frontmatter header: opening `---`, YAML block, closing `---`,
 *  and a trailing blank line before the body. */
function renderFrontmatter(fields: Record<string, unknown>): string {
  const yaml = YAML.stringify(fields, { indent: 2, lineWidth: 100 });
  return `---\n${yaml}---\n\n`;
}

function renderOpenCodeAgent(agent: AgentRecord, format: 'v1' | 'v2'): RenderedAgent {
  const { permission, tools } = translatePermissions(agent);

  const fields: Record<string, unknown> = {
    description: agent.description,
    mode: agent.mode,
    // The effective model wins in rendered output (DEC-004): model_override
    // when the descriptor carries one, else the team recommendation. The
    // source YAML model field is never mutated by deployment.
    model: agent.effectiveModel,
    temperature: agent.temperature,
  };
  if (format === 'v2') {
    fields.permission = permission;
  } else {
    fields.tools = tools;
  }

  const content = `${renderFrontmatter(fields)}${agent.systemPrompt}\n`;
  return { path: `agents/${agent.id}.md`, content };
}

const renderV1 = (agent: AgentRecord): RenderedAgent =>
  renderOpenCodeAgent(agent, 'v1');

const renderV2 = (agent: AgentRecord): RenderedAgent =>
  renderOpenCodeAgent(agent, 'v2');

/** OpenCode renderers in registry-consumable form; index.ts registers them. */
export const OPENCODE_RENDERERS: AgentRenderer[] = [
  { platform: 'opencode', version: 1, renderAgent: renderV1 },
  { platform: 'opencode', version: 2, renderAgent: renderV2 },
];
