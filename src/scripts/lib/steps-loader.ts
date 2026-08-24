import { readYaml } from './yaml-io.ts';
import { getStageById } from './stage-registry.ts';
import type { StageRecord } from './stage-registry.ts';

export interface CompleteWhenPredicate {
  all?: CompleteWhenPredicate[];
  any?: CompleteWhenPredicate[];
  field?: string;
  non_empty?: boolean;
  equals?: unknown;
  array?: string;
  min_items?: number;
}

export interface StepDefinition {
  title?: string;
  next_action?: string;
  markdown?: string;
  commands?: string[];
  exit_criteria?: string | null | Record<string, unknown>;
  complete_when?: CompleteWhenPredicate;
}

export interface StepsDoc {
  version?: number;
  steps: Record<string, StepDefinition>;
}

function resolveDotPath(artifact: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, artifact);
}

/**
 * Evaluates the declarative complete_when predicate vocabulary (DM-003): field
 * non-empty, array min-items, field equals, and all/any combinators. A missing
 * predicate means the step is complete.
 */
export function evaluatePredicate(
  predicate: CompleteWhenPredicate | undefined,
  artifact: Record<string, unknown>
): boolean {
  if (!predicate) return true;

  if (Array.isArray(predicate.all)) {
    return predicate.all.every((p) => evaluatePredicate(p, artifact));
  }

  if (Array.isArray(predicate.any)) {
    return predicate.any.some((p) => evaluatePredicate(p, artifact));
  }

  if (predicate.array) {
    const arr = artifact?.[predicate.array];
    return Array.isArray(arr) && arr.length >= Number(predicate.min_items ?? 1);
  }

  if (predicate.field) {
    const value = resolveDotPath(artifact, predicate.field);
    if (predicate.non_empty) {
      return typeof value === 'string' && value.trim().length > 0;
    }
    if (predicate.equals !== undefined) {
      return value === predicate.equals;
    }
    return false;
  }

  return true;
}

/**
 * Loads the step definitions for a stage from its steps.yaml (CMP-007,
 * DM-003), replacing the hardcoded stepDefinitionsByWorkflow map.
 */
export function loadStepDefinitions(stage: StageRecord): Record<string, StepDefinition> {
  if (!stage.files.steps) return {};

  const doc = readYaml(stage.files.steps) as StepsDoc | null;
  if (!doc || typeof doc.steps !== 'object' || doc.steps === null) return {};

  return doc.steps;
}

const stepsCache = new Map<string, Record<string, StepDefinition>>();

/**
 * Loader-backed getStepDefinitions over the discovered stages: resolves the
 * workflow id to a stage and returns its steps.yaml definitions. Keeps the
 * skillManifest consumer contract.
 */
export function getStepDefinitions(
  workflowId: string,
  cwd: string = process.cwd()
): Record<string, StepDefinition> | null {
  const stage = getStageById(cwd, workflowId);
  if (!stage) return null;

  if (stepsCache.has(stage.folder)) {
    return stepsCache.get(stage.folder) as Record<string, StepDefinition>;
  }

  const definitions = loadStepDefinitions(stage);
  stepsCache.set(stage.folder, definitions);
  return definitions;
}
