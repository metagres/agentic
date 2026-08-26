import { evaluatePredicate, loadStepDefinitions } from './steps-loader.ts';
import type { CompleteWhenPredicate } from './steps-loader.ts';
import { deltaComplete } from './stage-helpers.ts';
import type { StageRecord } from './stage-registry.ts';
import type { WarningItem, Finding } from './types.ts';

// Canonical authoring step ids (FLW-002): the six-step tour every authoring
// stage declares in steps.yaml. Any other step declared in steps.yaml is an
// extra step driven by its complete_when predicate.
export const CANONICAL_STEPS = new Set([
  'needs_input',
  'init',
  'authoring',
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
 * Generic authoring step machine (FLW-002): needs_input, init, authoring,
 * ready, complete, recovery. The current step is detected purely from artifact
 * state — never from stage hooks or granular in-artifact confirmation flags:
 * - no change root -> needs_input; no artifact -> init
 * - init predicate unsatisfied -> init (created but empty)
 * - rejected status or blocking mechanical findings -> recovery
 * - ready-for-review / accepted -> complete, otherwise the tour runs through
 *   ready (authoring predicate satisfied) or authoring (still drafting).
 * Stage-declared extra steps beyond the canonical six remain declarative and
 * are evaluated through their complete_when predicates from steps.yaml.
 */
export function detectStep(env: AuthorEnv): string {
  if (!env.changeRoot) return 'needs_input';
  const artifact = env.artifact;
  if (!artifact) return 'init';
  const metadata = (artifact.metadata as Record<string, unknown>) || {};
  if (metadata?.status === 'rejected') return 'recovery';

  if (!evaluatePredicate(stepPredicate(env, 'init'), artifact)) return 'init';

  const blockingCount = (env.blocking as unknown[])?.length || 0;
  if (blockingCount > 0) return 'recovery';

  const steps = loadStepDefinitions(env.stage);
  for (const stepId of Object.keys(steps)) {
    if (CANONICAL_STEPS.has(stepId)) continue;
    if (!evaluatePredicate(steps[stepId]?.complete_when, artifact)) return stepId;
  }

  if (metadata?.status === 'ready-for-review' || metadata?.status === 'accepted') {
    return 'complete';
  }
  return evaluatePredicate(stepPredicate(env, 'authoring'), artifact) ? 'ready' : 'authoring';
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
  if (!evaluatePredicate(stepPredicate(env, 'authoring'), artifact)) {
    reasons.push('authoring is not complete');
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
    authoring_complete: evaluatePredicate(stepPredicate(env, 'authoring'), artifact),
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
