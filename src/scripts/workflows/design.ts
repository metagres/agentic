import path from 'node:path';

import { today, nextIdsFromArrays } from '../lib/ids.ts';
import { safeReadYaml } from '../lib/context.ts';

import { deltaComplete, titleFromRequest, baseVersion } from '../lib/stage-helpers.ts';
import type { WarningItem } from '../lib/types.ts';
import { detectStep, isReadyForReview, getData } from '../lib/authoring-base.ts';
import type { AuthoringStageConfig } from '../lib/authoring-base.ts';

function draftComplete(artifact: Record<string, unknown>) {
  const hasContext = Boolean(
    artifact?.context_summary && String(artifact.context_summary).trim()
  );

  const components = Array.isArray(artifact?.components)
    ? (artifact.components as unknown[]).length
    : 0;

  const decisions = Array.isArray(artifact?.decisions)
    ? (artifact.decisions as unknown[]).length
    : 0;

  const traceability = Array.isArray(artifact?.traceability)
    ? (artifact.traceability as unknown[]).length
    : 0;

  return hasContext && components > 0 && decisions > 0 && traceability > 0;
}

function preconditionWarnings(env: Record<string, unknown>) {
  const warnings: WarningItem[] = [];

  if (!env.changeRoot) return warnings;

  const requirements = safeReadYaml(
    path.join(env.changeRoot as string, 'requirements.yaml')
  ) as Record<string, unknown> | null;

  if (requirements) {
    const metadata = (requirements?.metadata as Record<string, unknown>) || {};
    const status = metadata?.status as string;

    if (!['ready-for-review', 'accepted'].includes(status)) {
      warnings.push({
        code: 'PREVIOUS_STAGE_NOT_READY',
        message:
          `requirements.yaml status is '${status || 'unknown'}'. ` +
          'Consider completing the requirements stage before finalizing design.',
      });
    }
  }

  return warnings;
}

const config: AuthoringStageConfig = {
  id: 'design',
  artifactFile: 'design.yaml',
  deltaPhase: 'Design',
  initComplete: (artifact) => {
    const metadata = (artifact.metadata as Record<string, unknown>) || {};
    return Boolean(metadata?.based_on_requirements);
  },
  draftComplete,
  preconditionWarnings,
  getExtraData: (env) => {
    const artifact = (env.artifact || {}) as Record<string, unknown>;
    const metadata = (artifact.metadata as Record<string, unknown>) || {};
    return {
      based_on_requirements: metadata?.based_on_requirements as string || null,
    };
  },
};

export const designStage = {
  ...config,
  initialArtifact(request: string, env: Record<string, unknown>) {
    const requirementsVersion = baseVersion(
      env.changeRoot as string,
      'requirements.yaml'
    );

    return {
      metadata: {
        id: 'DES-001',
        title: `Design: ${titleFromRequest(request, 'Untitled design')}`,
        stage: 'design',
        step: 'init',
        status: 'draft',
        version: '0.1.0',
        created: today(),
        updated: today(),
        based_on_requirements: requirementsVersion,
        delta_reviewed: false,
      },
      context_summary: '',
      components: [],
      data_models: [],
      apis: [],
      flows: [],
      decisions: [],
      traceability: [],
      delta: [],
    };
  },

  nextIds(artifact: Record<string, unknown>) {
    return nextIdsFromArrays(artifact, {
      CMP: 'components',
      DM: 'data_models',
      API: 'apis',
      DEC: 'decisions',
    });
  },

  detectStep: (env: Record<string, unknown>) => detectStep(env, config),
  isReadyForReview: (env: Record<string, unknown>) => isReadyForReview(env, config),
  getData: (env: Record<string, unknown>) => getData(env, config),
};