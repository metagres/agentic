import fs from 'node:fs';
import path from 'node:path';

import { resolveAgentsDir } from './paths.ts';
import { readYaml } from './yaml-io.ts';
import { validateWithSchema } from './schema.ts';

/**
 * Runtime registry entry (DEC-001): the parsed agent descriptor. The source is
 * neutral YAML under src/agents/; all platform-specific knowledge lives in the
 * deployment-layer renderers, so this record carries only the neutral fields.
 */
export interface AgentRecord {
  id: string;
  file: string;
  description: string;
  model: string;
  /** Optional free-form personal override (model_override); null when absent. */
  modelOverride: string | null;
  /** The value that wins at deploy/surface time: modelOverride ?? model (DEC-004). */
  effectiveModel: string;
  temperature: number;
  mode: string;
  permissions: Record<string, string>;
  systemPrompt: string;
}

function loadAgentFile(file: string, cwd: string): AgentRecord {
  const id = path.basename(file, '.yaml');

  let descriptor: Record<string, unknown>;
  try {
    descriptor = readYaml(file) as Record<string, unknown>;
  } catch (err: unknown) {
    throw new Error(
      `Agent file '${path.basename(file)}' has invalid YAML: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error(`Agent file '${path.basename(file)}' has an invalid descriptor.`);
  }

  const schemaFindings = validateWithSchema(descriptor, 'agent.schema.yaml', cwd);
  if (schemaFindings.length > 0) {
    throw new Error(
      `Agent file '${path.basename(file)}' has an invalid descriptor: ${schemaFindings
        .map((f) => f.finding)
        .join('; ')}`
    );
  }

  const descriptorId = descriptor.id as string;
  if (descriptorId !== id) {
    throw new Error(
      `Agent file '${path.basename(file)}' does not match its descriptor id '${descriptorId}'.`
    );
  }

  const model = String(descriptor.model || '');
  const modelOverride =
    typeof descriptor.model_override === 'string' && descriptor.model_override.length > 0
      ? descriptor.model_override
      : null;

  return {
    id,
    file,
    description: String(descriptor.description || ''),
    model,
    modelOverride,
    effectiveModel: modelOverride ?? model,
    temperature: Number(descriptor.temperature ?? 0),
    mode: typeof descriptor.mode === 'string' ? descriptor.mode : 'all',
    permissions: (descriptor.permissions as Record<string, string>) || {},
    systemPrompt: String(descriptor.system_prompt || ''),
  };
}

const registryCache = new Map<string, AgentRecord[]>();

/**
 * loadAgentRegistry(cwd): scans the agents directory for *.yaml files, parses
 * and validates each against agent.schema.yaml, enforces that the descriptor id
 * equals the filename stem, and returns the cached registry. Throws startup
 * errors naming the offending file for malformed YAML, schema violations, and
 * id/filename mismatches. A missing or empty agents directory yields an empty
 * registry (not an error) so projects without agents keep working. An explicit
 * agentsDir may be supplied for tests that exercise fixture agents directories.
 */
export function loadAgentRegistry(
  cwd: string = process.cwd(),
  agentsDir?: string
): AgentRecord[] {
  const resolvedDir = agentsDir || resolveAgentsDir(cwd);
  if (!resolvedDir || !fs.existsSync(resolvedDir)) {
    return [];
  }

  if (registryCache.has(resolvedDir)) {
    return registryCache.get(resolvedDir) as AgentRecord[];
  }

  const files = fs
    .readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => entry.name)
    .sort();

  const registry = files.map((name) =>
    loadAgentFile(path.join(resolvedDir, name), cwd)
  );
  registryCache.set(resolvedDir, registry);
  return registry;
}

export function getAgentById(
  cwd: string,
  agentId: string,
  agentsDir?: string
): AgentRecord | null {
  const registry = loadAgentRegistry(cwd, agentsDir);
  return registry.find((agent) => agent.id === agentId) || null;
}

/**
 * CLI surfacing helper (DEC-004): the recommended/effective model pair for a
 * bound agent id, for envelope data entries. Returns an empty object when no
 * agent is bound or the binding does not resolve, so unbound entries carry no
 * model fields at all.
 */
export function getAgentModelFields(
  cwd: string,
  agentId: string | null,
  agentsDir?: string
): { model?: string; effectiveModel?: string } {
  if (!agentId) return {};
  const agent = getAgentById(cwd, agentId, agentsDir);
  if (!agent) return {};
  return { model: agent.model, effectiveModel: agent.effectiveModel };
}
