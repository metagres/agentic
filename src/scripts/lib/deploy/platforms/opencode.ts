/**
 * OpenCode agent renderer (TASK-009). Converts a neutral AgentRecord into the
 * OpenCode agent file format at `agents/<agent-id>.md`, and is the only module
 * allowed to encode OpenCode-specific knowledge.
 *
 * Two version variants are supported:
 *
 *   v2 — current format: a `permission` frontmatter map whose target tool keys
 *        (read, list, glob, grep, edit, write, apply_patch, bash, task,
 *        webfetch, websearch, question) carry the neutral level. The
 *        file-write targets (edit, write, apply_patch) carry an object: the
 *        neutral level for every path as the catch-all, plus deny patterns
 *        for the change-artifact directory — change artifacts are created and
 *        modified only through the sdlc CLI, so no deployed agent may edit
 *        them with structured file tools. Every other target carries the
 *        neutral level verbatim ('allow' | 'ask' | 'deny').
 *   v1 — legacy format: a `tools` frontmatter map over the same target keys
 *        with allow -> true, deny -> false, and ask omitted. Booleans cannot
 *        express path scoping, so the legacy format carries no
 *        change-artifact deny rule.
 *
 * The frontmatter follows the style of the generated SKILL.md (see
 * bin/deploy-to-agent.ts SKILL_TEMPLATE): `---`, `key: value` lines, closing
 * `---`, a blank line, then the body — the agent's system prompt verbatim
 * (AgentRecord.systemPrompt, carried inline in the source YAML including the
 * agent's own output-discipline instructions). The renderer holds no prompt
 * text of its own and no per-agent registration.
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

/** The change-artifact directory under the project root. Change artifacts are
 *  created and modified only through the sdlc CLI (invoked via bash), so the
 *  structured file-write tools of every deployed agent deny this path. */
const PROTECTED_ARTIFACT_DIR = 'docs/changes';

/** Deny patterns shielding PROTECTED_ARTIFACT_DIR in v2 file-write permission
 *  objects. Two patterns cover both relative and absolute tool-input paths;
 *  the agent's catch-all base level is inserted before them because OpenCode
 *  resolves object rules last-match-wins. */
const PROTECTED_WRITE_PATTERNS: readonly (readonly [string, string])[] = [
  [`**/${PROTECTED_ARTIFACT_DIR}/**`, 'deny'],
  [`${PROTECTED_ARTIFACT_DIR}/**`, 'deny'],
];

/**
 * Maps the agent's neutral permissions onto the OpenCode target tool keys.
 * Returns the flat v2 `permission` map (target -> neutral level; the v2
 * renderer path-scopes the file-write targets afterwards) and the v1 `tools`
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

/**
 * Path-scopes the v2 permission map: every file-write target whose neutral
 * level is not already a full deny carries the protected change-artifact
 * deny patterns after the agent's catch-all base level, so the agent keeps
 * its level for all other paths while docs/changes/** is always denied. A
 * flat 'deny' needs no object (nothing is writable either way).
 */
function scopeProtectedPaths(
  permission: Record<string, string>
): Record<string, string | Record<string, string>> {
  const scoped: Record<string, string | Record<string, string>> = {};
  for (const [target, level] of Object.entries(permission)) {
    if (NEUTRAL_TO_TARGET.file_write.includes(target) && level !== 'deny') {
      scoped[target] = { '*': level, ...Object.fromEntries(PROTECTED_WRITE_PATTERNS) };
    } else {
      scoped[target] = level;
    }
  }
  return scoped;
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
    fields.permission = scopeProtectedPaths(permission);
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
