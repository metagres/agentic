import { evaluatePredicate, loadStepDefinitions } from './steps-loader.ts';
import type { CompleteWhenPredicate } from './steps-loader.ts';
import { deltaComplete } from './stage-helpers.ts';
import type { StageRecord } from './stage-registry.ts';
import type { WarningItem, Finding } from './types.ts';

// Canonical authoring step ids; any other step declared in steps.yaml is an
// extra step driven by its complete_when predicate or the stage hooks module.
export const CANONICAL_STEPS = new Set([
  'needs_input',
  'init',
  'drafting',
  'validation',
  'delta',
  'ready',
  'complete',
  'recovery',
]);

export interface AuthorEnv {
  [key: string]: unknown;
  args: Record<string, unknown>;
  cwd: string;
  changeRoot: string | null;
  artifactPath: string | null;
  artifact: Record<string, unknown> | null;
  stage: StageRecord;
  warnings: WarningItem[];
  hooks: Record<string, unknown> | null;
  readYaml: (file: string) => unknown;
  findings?: Finding[];
  blocking?: Finding[];
  semantic?: { complete: boolean; missing: string[]; failed: string[]; results: unknown[] };
}

export function stepPredicate(
  env: AuthorEnv,
  stepId: string
): CompleteWhenPredicate | undefined {
  const steps = loadStepDefinitions(env.stage);
  return steps[stepId]?.complete_when;
}

/**
 * Generic authoring step machine (FLW-002): needs_input, init, recovery,
 * stage-declared extra steps, drafting, validation, delta, ready, complete.
 * Artifact-driven steps (init, drafting, delta, extra steps) are evaluated
 * through declarative complete_when predicates from steps.yaml (DM-003); the
 * interaction steps (validation, recovery, ready, complete) are evaluated from
 * runtime validation state and artifact status exactly as before.
 */
export function detectStep(env: AuthorEnv): string {
  if (!env.changeRoot) return 'needs_input';
  const artifact = env.artifact;
  if (!artifact) return 'init';
  const metadata = (artifact.metadata as Record<string, unknown>) || {};
  if (metadata?.status === 'rejected') return 'recovery';

  if (!evaluatePredicate(stepPredicate(env, 'init'), artifact)) return 'init';

  // Extra steps come first from the stage hooks module (requirements discovery
  // gate / assumptions), then from declarative extra steps in steps.yaml.
  const hooks = env.hooks as Record<string, unknown> | null;
  if (hooks && typeof hooks.extraStep === 'function') {
    const extra = (hooks.extraStep as (e: AuthorEnv) => string | null)(env);
    if (extra) return extra;
  }

  const steps = loadStepDefinitions(env.stage);
  for (const stepId of Object.keys(steps)) {
    if (CANONICAL_STEPS.has(stepId)) continue;
    if (!evaluatePredicate(steps[stepId]?.complete_when, artifact)) return stepId;
  }

  if (!evaluatePredicate(stepPredicate(env, 'drafting'), artifact)) return 'drafting';

  const blockingCount = (env.blocking as unknown[])?.length || 0;
  const semantic = env.semantic as { complete?: boolean } | undefined;
  const semanticComplete = Boolean(semantic?.complete);
  if (blockingCount > 0 || !semanticComplete) return 'validation';

  if (!evaluatePredicate(stepPredicate(env, 'delta'), artifact)) return 'delta';
  if (metadata?.status === 'ready-for-review' || metadata?.status === 'accepted') {
    return 'complete';
  }
  return 'ready';
}

export function isReadyForReview(env: AuthorEnv): { ready: boolean; reasons: string[] } {
  const artifact = env.artifact;
  const reasons: string[] = [];
  if (!artifact) {
    reasons.push('artifact is missing');
    return { ready: false, reasons };
  }

  if (!evaluatePredicate(stepPredicate(env, 'init'), artifact)) {
    reasons.push('init is not complete');
  }
  if (!evaluatePredicate(stepPredicate(env, 'drafting'), artifact)) {
    reasons.push('draft is not complete');
  }
  const blockingCount = (env.blocking as unknown[])?.length || 0;
  if (blockingCount > 0) {
    reasons.push(`${blockingCount} blocking mechanical finding(s)`);
  }
  const semantic = env.semantic as { complete?: boolean } | undefined;
  if (!semantic?.complete) {
    reasons.push('semantic validation incomplete');
  }
  if (!deltaComplete(artifact)) {
    reasons.push('delta is not complete');
  }
  return { ready: reasons.length === 0, reasons };
}

export function getData(env: AuthorEnv): Record<string, unknown> {
  const artifact = (env.artifact || {}) as Record<string, unknown>;
  const semantic = env.semantic as { complete?: boolean } | undefined;
  const data: Record<string, unknown> = {
    draft_complete: evaluatePredicate(stepPredicate(env, 'drafting'), artifact),
    mechanical_valid: ((env.blocking as unknown[])?.length || 0) === 0,
    semantic_complete: Boolean(semantic?.complete),
    delta_complete: deltaComplete(artifact),
  };

  const hooks = env.hooks as Record<string, unknown> | null;
  if (hooks && typeof hooks.getExtraData === 'function') {
    Object.assign(data, (hooks.getExtraData as (e: AuthorEnv) => Record<string, unknown>)(env));
  }

  return data;
}
