/**
 * Deployment-layer platform renderer registry (TASK-009). This is the ONLY
 * place in the codebase where coding-agent-specific knowledge is allowed: the
 * toolkit engine is agent-agnostic (repo invariant), and every detail of a
 * specific coding agent's file format lives behind the renderers registered
 * here. Renderers are keyed by platform name and version; `getRenderer`
 * resolves a concrete renderer from the neutral AgentRecord.
 */
import type { AgentRecord } from '../../agent-registry.ts';
import { OPENCODE_RENDERERS } from './opencode.ts';

/** A rendered agent file. `path` is relative to the deployment target root
 *  (e.g. 'agents/stage-reviewer.md'); `content` is the full file text. */
export interface RenderedAgent {
  path: string;
  content: string;
}

/** A renderer for one platform format version. `platform` names the target
 *  coding agent ('opencode'); `version` identifies the format revision. */
export interface AgentRenderer {
  platform: string;
  version: number;
  renderAgent(agent: AgentRecord): RenderedAgent;
}

// Platform name -> renderers sorted by ascending version. Highest version wins
// for the default/'latest' resolution.
const REGISTRY = new Map<string, AgentRenderer[]>();

for (const renderer of [...OPENCODE_RENDERERS]) {
  const versions = REGISTRY.get(renderer.platform) ?? [];
  versions.push(renderer);
  REGISTRY.set(renderer.platform, versions);
}
for (const versions of REGISTRY.values()) {
  versions.sort((a, b) => a.version - b.version);
}

/** Lists every registered platform with the versions it supports (ascending),
 *  sorted by platform name. Useful for error messages and tests. */
export function listPlatforms(): { platform: string; versions: number[] }[] {
  return [...REGISTRY.entries()]
    .map(([platform, renderers]) => ({
      platform,
      versions: renderers.map((renderer) => renderer.version),
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform));
}

function describeRegistry(): string {
  return listPlatforms()
    .map(({ platform, versions }) => `${platform} (versions: ${versions.join(', ')})`)
    .join(', ');
}

/**
 * Resolves the renderer for a platform. An omitted version or 'latest' picks
 * the highest known version of the platform. Unknown platforms and unknown
 * versions throw errors that list the supported platforms and versions.
 */
export function getRenderer(
  platform: string,
  version?: number | 'latest'
): AgentRenderer {
  const versions = REGISTRY.get(platform);
  if (!versions || versions.length === 0) {
    throw new Error(
      `Unknown platform '${platform}'. Supported: ${describeRegistry()}.`
    );
  }

  const resolved =
    version === undefined || version === 'latest'
      ? versions[versions.length - 1]
      : versions.find((renderer) => renderer.version === version);

  if (!resolved) {
    throw new Error(
      `Unknown version '${String(version)}' for platform '${platform}'. Supported: ${versions
        .map((renderer) => renderer.version)
        .join(', ')}.`
    );
  }

  return resolved;
}
