import { deltaComplete } from './stage-helpers.ts';
import type { WarningItem } from './types.ts';

export interface AuthoringStageConfig {
  id: string;
  artifactFile: string;
  deltaPhase: string;
  // Predicate: is the artifact's init step complete?
  initComplete: (artifact: Record<string, unknown>) => boolean;
  // Predicate: is the draft complete?
  draftComplete: (artifact: Record<string, unknown>) => boolean;
  // Optional: extra steps between init and drafting (requirements: discovery, assumptions)
  // Returns a step id if an extra step is needed, or null to continue.
  extraStep?: (env: Record<string, unknown>) => string | null;
  // Optional: stage-specific getData fields
  getExtraData?: (env: Record<string, unknown>) => Record<string, unknown>;
  // Optional: precondition warnings
  preconditionWarnings?: (env: Record<string, unknown>) => WarningItem[];
}

export function detectStep(env: Record<string, unknown>, config: AuthoringStageConfig): string {
  if (!env.changeRoot) return 'needs_input';
  const artifact = env.artifact as Record<string, unknown> | null;
  if (!artifact) return 'init';
  const metadata = (artifact.metadata as Record<string, unknown>) || {};
  if (metadata?.status === 'rejected') return 'recovery';
  if (!config.initComplete(artifact)) return 'init';
  if (config.extraStep) {
    const extra = config.extraStep(env);
    if (extra) return extra;
  }
  if (!config.draftComplete(artifact)) return 'drafting';
  const blockingCount = (env.blocking as unknown[])?.length || 0;
  const semantic = env.semantic as Record<string, unknown> | undefined;
  const semanticComplete = (semantic?.complete as boolean) ?? false;
  if (blockingCount > 0 || !semanticComplete) return 'validation';
  if (!deltaComplete(artifact)) return 'delta';
  if (metadata?.status === 'ready-for-review' || metadata?.status === 'accepted') return 'complete';
  return 'ready';
}

export function isReadyForReview(env: Record<string, unknown>, config: AuthoringStageConfig): { ready: boolean; reasons: string[] } {
  const artifact = env.artifact as Record<string, unknown>;
  const reasons: string[] = [];
  if (!config.initComplete(artifact)) {
    reasons.push(`${config.id} init is not complete`);
  }
  if (!config.draftComplete(artifact)) {
    reasons.push(`${config.id} draft is not complete`);
  }
  const blockingCount = (env.blocking as unknown[])?.length || 0;
  if (blockingCount > 0) {
    reasons.push(`${blockingCount} blocking mechanical finding(s)`);
  }
  const semantic = env.semantic as Record<string, unknown> | undefined;
  if (!semantic?.complete) {
    const missing = ((semantic?.missing as string[]) || []).join(', ');
    const failed = ((semantic?.failed as string[]) || []).join(', ');
    reasons.push(`semantic validation incomplete (missing: ${missing || 'none'}, failed: ${failed || 'none'})`);
  }
  if (!deltaComplete(artifact)) {
    reasons.push('delta is not complete');
  }
  return { ready: reasons.length === 0, reasons };
}

export function getData(env: Record<string, unknown>, config: AuthoringStageConfig): Record<string, unknown> {
  const artifact = (env.artifact || {}) as Record<string, unknown>;
  const semantic = env.semantic as Record<string, unknown> | undefined;
  const data: Record<string, unknown> = {
    draft_complete: config.draftComplete(artifact),
    mechanical_valid: ((env.blocking as unknown[])?.length || 0) === 0,
    semantic_complete: Boolean(semantic?.complete),
    delta_complete: deltaComplete(artifact),
  };
  if (config.getExtraData) {
    Object.assign(data, config.getExtraData(env));
  }
  return data;
}