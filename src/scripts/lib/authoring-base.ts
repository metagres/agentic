import { evaluatePredicate, loadStepDefinitions } from './steps-loader.ts';
import type { CompleteWhenPredicate } from './steps-loader.ts';
import { deltaComplete } from './stage-helpers.ts';
import type { StageRecord } from './stage-registry.ts';
import type { WarningItem, Finding } from './types.ts';

// Canonical authoring step ids (FLW-002): the six-step tour every authoring
// stage declares in steps.yaml. Any other step declared in steps.yaml is an
// extra step driven by its complete_when predicate.
export const CANONICAL_STEPS = new Set([
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
}

export function stepPredicate(
  env: AuthorEnv,
  stepId: string
): CompleteWhenPredicate | undefined {
  const steps = loadStepDefinitions(env.stage);
  return steps[stepId]?.complete_when;
}

/**
 * Generic authoring step machine (FLW-002, engagement contract): authoring,
 * ready, complete, recovery. The current step is detected purely from
 * artifact state — never from stage hooks or granular in-artifact
 * confirmation flags. A change-less stage invocation is a usage error
 * (the engagement backstop), never a step:
 * - no artifact -> authoring (created but empty)
 * - rejected status or any mechanical finding -> recovery (every finding
 *   blocks by definition)
 * - ready-for-review / accepted -> complete, otherwise the tour runs through
 *   ready (authoring predicate satisfied) or authoring (still drafting).
 * Stage-declared extra steps beyond the canonical four remain declarative
 * and are evaluated through their complete_when predicates from steps.yaml.
 */
export function detectStep(env: AuthorEnv): string {
  const artifact = env.artifact;
  if (!artifact) return 'authoring';
  const metadata = (artifact.metadata as Record<string, unknown>) || {};
  if (metadata?.status === 'rejected') return 'recovery';

  const findingCount = (env.findings as unknown[])?.length || 0;
  if (findingCount > 0) return 'recovery';

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

  if (!evaluatePredicate(stepPredicate(env, 'authoring'), artifact)) {
    reasons.push('authoring is not complete');
  }
  const findingCount = (env.findings as unknown[])?.length || 0;
  if (findingCount > 0) {
    reasons.push(`${findingCount} mechanical finding(s)`);
  }
  if (!deltaComplete(artifact)) {
    reasons.push('delta is not complete');
  }
  return { ready: reasons.length === 0, reasons };
}

export function getData(env: AuthorEnv): Record<string, unknown> {
  const artifact = (env.artifact || {}) as Record<string, unknown>;
  // semantic_complete derives from artifact status (DEC-002): true exactly for
  // ready-for-review and accepted, false for draft, rejected, and a missing
  // artifact. The environment semantic summary is not consulted here.
  const metadata = (artifact.metadata as Record<string, unknown>) || {};
  const status = metadata.status;
  const data: Record<string, unknown> = {
    authoring_complete: evaluatePredicate(stepPredicate(env, 'authoring'), artifact),
    mechanical_valid: ((env.findings as unknown[])?.length || 0) === 0,
    semantic_complete: status === 'ready-for-review' || status === 'accepted',
    delta_complete: deltaComplete(artifact),
  };

  const hooks = env.hooks as Record<string, unknown> | null;
  if (hooks && typeof hooks.getExtraData === 'function') {
    Object.assign(data, (hooks.getExtraData as (e: AuthorEnv) => Record<string, unknown>)(env));
  }

  return data;
}
