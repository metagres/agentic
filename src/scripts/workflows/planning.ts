import path from 'node:path';

import { today, nextIdsFromArrays } from '../lib/ids.ts';
import { safeReadYaml } from '../lib/context.ts';

import { deltaComplete, titleFromRequest, baseVersion } from '../lib/stage-helpers.ts';
import type { WarningItem } from '../lib/types.ts';
import { detectStep, isReadyForReview, getData } from '../lib/authoring-base.ts';
import type { AuthoringStageConfig } from '../lib/authoring-base.ts';

function draftComplete(artifact: Record<string, unknown>) {
  return Array.isArray(artifact?.tasks) && (artifact.tasks as unknown[]).length > 0;
}

function preconditionWarnings(env: Record<string, unknown>) {
  const warnings: WarningItem[] = [];

  if (!env.changeRoot) return warnings;

  const design = safeReadYaml(path.join(env.changeRoot as string, 'design.yaml')) as Record<string, unknown> | null;

  if (design) {
    const metadata = (design?.metadata as Record<string, unknown>) || {};
    const status = metadata?.status as string;

    if (!['ready-for-review', 'accepted'].includes(status)) {
      warnings.push({
        code: 'PREVIOUS_STAGE_NOT_READY',
        message:
          `design.yaml status is '${status || 'unknown'}'. ` +
          'Consider completing the design stage before finalizing planning.',
      });
    }
  }

  const requirements = safeReadYaml(
    path.join(env.changeRoot as string, 'requirements.yaml')
  ) as Record<string, unknown> | null;

  if (requirements) {
    const metadata = (requirements?.metadata as Record<string, unknown>) || {};
    const status = metadata?.status as string;

    if (!['ready-for-review', 'accepted'].includes(status)) {
      warnings.push({
        code: 'REQUIREMENTS_NOT_READY',
        message:
          `requirements.yaml status is '${status || 'unknown'}'. ` +
          'Consider completing requirements before finalizing planning.',
      });
    }
  }

  return warnings;
}

const config: AuthoringStageConfig = {
  id: 'planning',
  artifactFile: 'plan.yaml',
  deltaPhase: 'Planning',
  initComplete: (artifact) => {
    const metadata = (artifact.metadata as Record<string, unknown>) || {};
    return Boolean(metadata?.based_on_design);
  },
  draftComplete,
  preconditionWarnings,
  getExtraData: (env) => {
    const artifact = (env.artifact || {}) as Record<string, unknown>;
    const metadata = (artifact.metadata as Record<string, unknown>) || {};
    return {
      based_on_design: metadata?.based_on_design as string || null,
      based_on_requirements:
        metadata?.based_on_requirements as string || null,
    };
  },
};

export const planningStage = {
  ...config,
  initialArtifact(request: string, env: Record<string, unknown>) {
    const designVersion = baseVersion(env.changeRoot as string, 'design.yaml');
    const requirementsVersion = baseVersion(
      env.changeRoot as string,
      'requirements.yaml'
    );

    return {
      metadata: {
        id: 'PLAN-001',
        title: `Plan: ${titleFromRequest(request, 'Untitled plan')}`,
        stage: 'planning',
        step: 'init',
        status: 'draft',
        version: '0.1.0',
        created: today(),
        updated: today(),
        based_on_design: designVersion,
        based_on_requirements: requirementsVersion,
        delta_reviewed: false,
      },
      tasks: [],
      milestones: [],
      risks: [],
      delta: [],
    };
  },

  nextIds(artifact: Record<string, unknown>) {
    return nextIdsFromArrays(artifact, {
      TASK: 'tasks',
    });
  },

  detectStep: (env: Record<string, unknown>) => detectStep(env, config),
  isReadyForReview: (env: Record<string, unknown>) => isReadyForReview(env, config),
  getData: (env: Record<string, unknown>) => getData(env, config),
};