/**
 * Kind permission contracts and the deterministic agent compatibility check
 * (CMP-003 / DEC-005 / DM-002). This module is pure: it performs no I/O, never
 * invokes a subagent or LLM, and has no knowledge of any specific agent
 * runtime. It pins each stage kind to the neutral permission profile its
 * interpreter relies on, folds a stage descriptor's optional overrides into an
 * effective requirement set, and verifies bound agents' declarations against
 * those requirements so instruction drift can never silently outgrow the
 * permissions an agent actually holds (NFR-005). All functions are
 * deterministic: identical inputs always produce identical outputs.
 */
import type { StageKind } from './stage-registry.ts';

/** The three levels an agent declaration may carry. */
export type PermissionLevel = 'allow' | 'ask' | 'deny';

/** The two levels an effective requirement may carry: allow is a floor, deny
 *  is a ceiling. */
export type PermissionRequirement = 'allow' | 'deny';

/** The neutral permission vocabulary an agent declares (NFR-001). */
export type PermissionKey = 'file_read' | 'search' | 'file_write' | 'shell' | 'subagent' | 'web';

/** A partial key → requirement map; absent keys are unconstrained. */
export type PermissionContract = Partial<Record<PermissionKey, PermissionRequirement>>;

const PERMISSION_KEYS: readonly PermissionKey[] = [
  'file_read',
  'search',
  'file_write',
  'shell',
  'subagent',
  'web',
];

/**
 * Engine-owned contracts (DM-002, DEC-005): one entry per stage kind carrying
 * the neutral keys that kind's interpreter requires. 'allow' is a floor — a
 * bound agent MUST declare allow for the key; 'deny' is a ceiling — a bound
 * agent MUST declare deny. Keys absent from a contract are unconstrained: the
 * bound agent may declare allow, ask, or deny.
 */
export const KIND_PERMISSION_CONTRACTS: Record<StageKind, PermissionContract> = {
  authoring: {
    file_read: 'allow',
    file_write: 'allow',
    shell: 'allow',
    subagent: 'allow',
    web: 'deny',
  },
  review: {
    file_read: 'allow',
    search: 'allow',
    shell: 'allow',
    file_write: 'deny',
    subagent: 'deny',
    web: 'deny',
  },
  tasks: {
    file_read: 'allow',
    search: 'allow',
    file_write: 'allow',
    shell: 'allow',
    subagent: 'allow',
    web: 'deny',
  },
  aggregator: {
    file_read: 'allow',
    file_write: 'allow',
    shell: 'allow',
    subagent: 'allow',
    web: 'deny',
  },
};

function contractFor(kind: string): PermissionContract {
  if (
    kind === 'authoring' ||
    kind === 'review' ||
    kind === 'tasks' ||
    kind === 'aggregator'
  ) {
    return KIND_PERMISSION_CONTRACTS[kind];
  }
  // Unreachable from the registry (the stage meta-schema rejects unknown kinds
  // at startup); an unknown kind constrains nothing, only overrides apply.
  return {};
}

/** A stage record shape compatible with StageRecord (TASK-004). */
export interface EffectivePermissionsStage {
  kind: string;
  permissionOverrides?: Record<string, string>;
}

/**
 * API-003 computeEffectivePermissions(stage): the kind contract for the
 * stage's kind, with every neutral key the descriptor's optional permissions
 * map defines replaced by its override. Overrides are schema-enforced to
 * allow/deny (the stage meta-schema rejects 'ask'); a value outside that
 * vocabulary or a key outside the neutral six is ignored, so a misspelled
 * override can never weaken a contract. Pure and deterministic.
 */
export function computeEffectivePermissions(
  stage: EffectivePermissionsStage
): PermissionContract {
  const effective: PermissionContract = {
    ...contractFor(stage.kind),
  };
  for (const key of PERMISSION_KEYS) {
    const override = stage.permissionOverrides?.[key];
    if (override === 'allow' || override === 'deny') {
      effective[key] = override;
    }
  }
  return effective;
}

/** A stage binding as seen by the compatibility check (StageRecord-compatible). */
export interface CompatibilityStage {
  id: string;
  kind: string;
  agent: string | null;
  permissionOverrides?: Record<string, string>;
}

/** A resolvable agent with its declared neutral permissions. */
export interface CompatibilityAgent {
  id: string;
  permissions: Record<string, string>;
}

/**
 * One incompatibility. Rendered into engine-level validation findings
 * (AGENT_PERMISSION_INCOMPATIBLE, AGENT_REF_UNRESOLVED — TASK-007).
 */
export interface PermissionFinding {
  /** Stage whose binding produced the finding. */
  stage: string;
  /** The bound agent id. */
  agent: string;
  /** The permission key at fault; empty for binding-resolution findings where
   *  no key is involved (an agent id that does not resolve). */
  key: string;
  /** 'allow' (violated floor) or 'deny' (violated ceiling); for a conflict
   *  finding, the requirement of the `stage` binding while `actual` carries the
   *  clashing requirement of the `conflict_with` binding; 'resolvable' when the
   *  bound agent id is unknown. */
  required: string;
  /** The agent's declared level for the key, the clashing requirement of the
   *  `conflict_with` binding in a conflict finding, or 'unresolved' when the
   *  bound agent id is unknown ('missing' if the agent declares no value for
   *  the key at all, which the agent meta-schema deems invalid). */
  actual: string;
  /** Second stage id when two bindings of the same agent conflict on `key`
   *  (one requires allow, the other requires deny). */
  conflict_with?: string;
}

/**
 * API-004 checkAgentCompatibility(stages, agents): verifies every stage-to-
 * agent binding. A bound agent must resolve against the agents registry; its
 * permissions must satisfy each bound stage's effective requirements — floors
 * must be 'allow', ceilings must be 'deny' — evaluated over the union of floors
 * and the intersection of ceilings across all of that agent's bindings. When
 * two bindings require different levels for the same key the bindings are
 * unsatisfiable regardless of what the agent declares: a conflict finding is
 * reported naming the agent and both conflicting stage ids, and the key is not
 * additionally reported as an ordinary violation. An unresolvable bound agent
 * id produces one finding per binding with an empty `key`. Empty stages or a
 * compatible roster yield []. Output is deterministic (NFR-005): grouped by
 * agent and sorted by (stage, agent, key, conflict_with).
 */
export function checkAgentCompatibility(
  stages: CompatibilityStage[],
  agents: CompatibilityAgent[]
): PermissionFinding[] {
  const findings: PermissionFinding[] = [];
  const agentsById = new Map(agents.map((a) => [a.id, a]));

  const bindingsByAgent = new Map<string, CompatibilityStage[]>();
  for (const stage of stages) {
    if (!stage.agent) continue;
    const list = bindingsByAgent.get(stage.agent) ?? [];
    list.push(stage);
    bindingsByAgent.set(stage.agent, list);
  }

  for (const agentId of [...bindingsByAgent.keys()].sort()) {
    const bound = bindingsByAgent.get(agentId) ?? [];
    const agent = agentsById.get(agentId);
    if (!agent) {
      for (const stage of bound) {
        findings.push({
          stage: stage.id,
          agent: agentId,
          key: '',
          required: 'resolvable',
          actual: 'unresolved',
        });
      }
      continue;
    }

    // Aggregate each binding's effective requirements: floors (key must be
    // 'allow') and ceilings (key must be 'deny') with the stages carrying them.
    const floors = new Map<string, string[]>();
    const ceilings = new Map<string, string[]>();
    for (const stage of bound) {
      const effective = computeEffectivePermissions(stage);
      for (const [key, requirement] of Object.entries(effective)) {
        const target = requirement === 'allow' ? floors : ceilings;
        const stageIds = target.get(key) ?? [];
        stageIds.push(stage.id);
        target.set(key, stageIds);
      }
    }
    for (const list of floors.values()) list.sort();
    for (const list of ceilings.values()) list.sort();

    // Conflicts: the same key floored by one binding and ceilinged by another
    // is unsatisfiable — name the agent and both conflicting stages.
    for (const [key, floorStages] of floors) {
      const ceilingStages = ceilings.get(key);
      if (!ceilingStages) continue;
      for (const floorStage of floorStages) {
        for (const ceilingStage of ceilingStages) {
          findings.push({
            stage: floorStage,
            agent: agentId,
            key,
            required: 'allow',
            actual: 'deny',
            conflict_with: ceilingStage,
          });
        }
      }
    }

    // Union of floors: any binding that requires 'allow' forces it.
    for (const [key, floorStages] of floors) {
      if (ceilings.has(key)) continue; // already reported as a conflict
      const actual = agent.permissions[key];
      if (actual !== 'allow') {
        findings.push({
          stage: floorStages[0],
          agent: agentId,
          key,
          required: 'allow',
          actual: actual ?? 'missing',
        });
      }
    }

    // Intersection of ceilings: any binding that requires 'deny' forces it.
    for (const [key, ceilingStages] of ceilings) {
      if (floors.has(key)) continue; // already reported as a conflict
      const actual = agent.permissions[key];
      if (actual !== 'deny') {
        findings.push({
          stage: ceilingStages[0],
          agent: agentId,
          key,
          required: 'deny',
          actual: actual ?? 'missing',
        });
      }
    }
  }

  findings.sort(
    (a, b) =>
      a.stage.localeCompare(b.stage) ||
      a.agent.localeCompare(b.agent) ||
      a.key.localeCompare(b.key) ||
      (a.conflict_with ?? '').localeCompare(b.conflict_with ?? '')
  );
  return findings;
}