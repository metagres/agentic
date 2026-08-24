import path from 'node:path';

import { loadStageRegistry, getStageById } from './stage-registry.ts';
import type { StageRecord } from './stage-registry.ts';
import { safeReadYaml } from './context.ts';

export interface UnsatisfiedRequirement {
  stage: string;
  artifact: string;
  status: string;
  required: string;
}

export interface GateResult {
  satisfied: boolean;
  unsatisfied: UnsatisfiedRequirement[];
}

/**
 * Finds a cycle in the requires graph by DFS from the given nodes, returning
 * the stages in the cycle order or null when no cycle is reachable.
 */
function findCycle(
  registry: StageRecord[],
  starts: string[]
): string[] | null {
  const byId = new Map(registry.map((s) => [s.id, s]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    color.set(id, GRAY);
    stack.push(id);

    const stage = byId.get(id);
    for (const req of stage?.requires || []) {
      const c = color.get(req) ?? WHITE;
      if (c === GRAY) {
        const cycle = stack.slice(stack.indexOf(req)).concat(req);
        return cycle;
      }
      if (c === WHITE) {
        const found = visit(req);
        if (found) return found;
      }
    }

    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const id of starts) {
    if ((color.get(id) ?? WHITE) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }

  return null;
}

/**
 * API-002 computePipelineOrder(registry): topological order over the requires
 * graph with an alphabetical stage-id tie-break for deterministic output
 * (DEC-007). Hard errors name the missing stage or the cycle.
 */
export function computePipelineOrder(cwd: string, stagesDir?: string): string[] {
  const registry = loadStageRegistry(cwd, stagesDir);
  const byId = new Map(registry.map((s) => [s.id, s]));

  // 1. Missing references are a hard startup error naming the missing stage.
  for (const stage of registry) {
    for (const req of stage.requires) {
      if (!byId.has(req)) {
        throw new Error(
          `Stage '${stage.id}' requires unknown stage '${req}'.`
        );
      }
    }
  }

  // 2. Kahn's algorithm; alphabetical tie-break keeps output deterministic.
  const indegree = new Map<string, number>();
  for (const stage of registry) indegree.set(stage.id, 0);
  for (const stage of registry) {
    for (const req of stage.requires) {
      indegree.set(stage.id, (indegree.get(stage.id) || 0) + 1);
    }
  }

  const order: string[] = [];
  let ready = registry
    .filter((s) => (indegree.get(s.id) || 0) === 0)
    .map((s) => s.id)
    .sort();

  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    const stage = byId.get(id);

    const dependents = registry.filter((s) => s.requires.includes(id));
    for (const dep of dependents) {
      const next = (indegree.get(dep.id) || 0) - 1;
      indegree.set(dep.id, next);
      if (next === 0) {
        ready.push(dep.id);
        ready.sort();
      }
    }
  }

  // 3. Any unprocessed stage is part of a cycle: hard error naming the cycle.
  if (order.length < registry.length) {
    const remaining = registry
      .filter((s) => !order.includes(s.id))
      .map((s) => s.id);
    const cycle = findCycle(registry, remaining) || remaining;
    throw new Error(`Requires graph contains a cycle: ${cycle.join(' -> ')}`);
  }

  return order;
}

function readTrackedStatus(
  changeRoot: string,
  tracked: StageRecord
): string {
  const artifactFile = path.join(changeRoot, tracked.artifact);
  const artifact = safeReadYaml(artifactFile) as Record<string, unknown> | null;
  if (!artifact) return 'missing';
  const metadata = (artifact.metadata as Record<string, unknown>) || {};
  return String(metadata[tracked.statusField] || 'unknown');
}

/**
 * API-002 evaluateGate(stage, changeRoot): a stage is runnable only when every
 * required stage's tracked artifact has status accepted (DEC-008). The tracked
 * artifact of a review stage is the artifact of the stage it reviews. A review
 * stage itself is runnable when its tracked artifact is ready-for-review or
 * accepted, because it is the mechanism that produces acceptance.
 */
export function evaluateGate(
  stage: StageRecord,
  changeRoot: string,
  cwd: string = process.cwd(),
  stagesDir?: string
): GateResult {
  if (stage.kind === 'review') {
    const target = stage.reviews ? getStageById(cwd, stage.reviews, stagesDir) : null;
    if (!target) {
      return {
        satisfied: false,
        unsatisfied: [
          {
            stage: stage.reviews || stage.id,
            artifact: stage.artifact,
            status: 'missing',
            required: 'ready-for-review or accepted',
          },
        ],
      };
    }

    const status = readTrackedStatus(changeRoot, target);
    const satisfied =
      status === 'ready-for-review' || status === 'accepted';

    return {
      satisfied,
      unsatisfied: satisfied
        ? []
        : [
            {
              stage: target.id,
              artifact: target.artifact,
              status,
              required: 'ready-for-review or accepted',
            },
          ],
    };
  }

  const unsatisfied: UnsatisfiedRequirement[] = [];
  for (const reqId of stage.requires) {
    const req = getStageById(cwd, reqId, stagesDir);
    if (!req) continue;

    const tracked = req.kind === 'review'
      ? (req.reviews ? getStageById(cwd, req.reviews, stagesDir) : null)
      : req;

    if (!tracked) continue;

    const status = readTrackedStatus(changeRoot, tracked);
    if (status !== 'accepted') {
      unsatisfied.push({
        stage: reqId,
        artifact: tracked.artifact,
        status,
        required: 'accepted',
      });
    }
  }

  return { satisfied: unsatisfied.length === 0, unsatisfied };
}
