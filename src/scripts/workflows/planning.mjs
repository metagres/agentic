import path from 'node:path';

import { today, nextIdsFromArrays } from '../lib/ids.mjs';
import { safeReadYaml } from '../lib/context.mjs';

import { deltaComplete, titleFromRequest, baseVersion } from '../lib/stage-helpers.mjs';



function draftComplete(artifact) {
  return Array.isArray(artifact?.tasks) && artifact.tasks.length > 0;
}

export const planningStage = {
  id: 'planning',
  artifactFile: 'plan.yaml',
  contractFile: 'plan-contract.yaml',
  deltaPhase: 'Planning',

  stepIds: [
    'needs_input',
    'init',
    'drafting',
    'validation',
    'delta',
    'recovery',
    'ready',
    'complete',
  ],

  stepDefinitions: {
    needs_input: {
      title: 'Needs input',
      next_action: 'provide_change_or_request',
      markdown: `
Ask the user which change directory to plan.
`.trim(),
      commands: ['{{SDLC}} planning --dir <change-dir>'],
    },

    init: {
      title: 'Initialization',
      next_action: 'initialize_context',
      markdown: `
The script created the initial plan artifact.

Ensure design.yaml exists and has a version.
`.trim(),
      commands: ['{{SDLC}} planning --dir {{change_dir}}'],
    },

    drafting: {
      title: 'Drafting',
      next_action: 'update_artifact',
      markdown: `
Draft the plan artifact.

Use \`data.next_ids\` to choose the next TASK ids.
`.trim(),
      commands: [
        '{{SDLC}} planning --dir {{change_dir}} --next-ids',
        '{{SDLC}} planning --dir {{change_dir}} --update-artifact < plan.yaml',
      ],
    },

    validation: {
      title: 'Validation',
      next_action: 'fix_mechanical_errors_or_record_semantic_result',
      markdown: `
Fix mechanical validation errors first.

Then evaluate each semantic check in \`data.semantic_checks_to_run\`.
`.trim(),
      commands: [
        '{{SDLC}} planning --dir {{change_dir}} --record-semantic-result --check <check_id> --status pass --evidence "<evidence>"',
      ],
    },

    delta: {
      title: 'Delta',
      next_action: 'append_delta_or_complete_step',
      markdown: `
Determine which living docs are affected by the plan.

Use \`data.delta_allowed_target_docs\`.
`.trim(),
      commands: [
        '{{SDLC}} planning --dir {{change_dir}} --append-delta < delta.yaml',
        '{{SDLC}} planning --dir {{change_dir}} --complete-step --step delta',
      ],
    },

    recovery: {
      title: 'Recovery',
      next_action: 'fix_review_findings',
      markdown: `
The plan artifact was rejected by review.

Read \`data.review_report\`, fix blocking findings, update the artifact, and finalize again.
`.trim(),
      commands: [
        '{{SDLC}} planning --dir {{change_dir}} --update-artifact < plan.yaml',
        '{{SDLC}} planning --dir {{change_dir}} --finalize',
      ],
    },

    ready: {
      title: 'Ready',
      next_action: 'finalize',
      markdown: `
All gates passed.

Finalize the plan artifact.
`.trim(),
      commands: ['{{SDLC}} planning --dir {{change_dir}} --finalize'],
    },

    complete: {
      title: 'Complete',
      next_action: 'invoke_review',
      markdown: `
The plan artifact is ready for the review gate.
`.trim(),
      commands: ['{{SDLC}} review --target plan --dir {{change_dir}}'],
    },
  },

  initialArtifact(request, env) {
    const designVersion = baseVersion(env.changeRoot, 'design.yaml');
    const requirementsVersion = baseVersion(
      env.changeRoot,
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
      semantic_validation: [],
    };
  },

  nextIds(artifact) {
    return nextIdsFromArrays(artifact, {
      TASK: 'tasks',
    });
  },

  preconditionWarnings(env) {
    const warnings = [];

    if (!env.changeRoot) return warnings;

    const design = safeReadYaml(path.join(env.changeRoot, 'design.yaml'));

    if (design) {
      const status = design?.metadata?.status;

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
      path.join(env.changeRoot, 'requirements.yaml')
    );

    if (requirements) {
      const status = requirements?.metadata?.status;

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
  },

  detectStep(env) {
    if (!env.changeRoot) return 'needs_input';

    const artifact = env.artifact;

    if (!artifact) return 'init';

    if (artifact.metadata?.status === 'rejected') return 'recovery';

    if (!artifact.metadata?.based_on_design) return 'init';

    if (!draftComplete(artifact)) return 'drafting';

    const blockingCount = env.blocking?.length || 0;
    const semanticComplete = env.semantic?.complete ?? false;

    if (blockingCount > 0 || !semanticComplete) return 'validation';

    if (!deltaComplete(artifact)) return 'delta';

    if (
      artifact.metadata?.status === 'ready-for-review' ||
      artifact.metadata?.status === 'accepted'
    ) {
      return 'complete';
    }

    return 'ready';
  },

  isReadyForReview(env) {
    const artifact = env.artifact;
    const reasons = [];

    if (!artifact?.metadata?.based_on_design) {
      reasons.push('plan is not based on a design artifact version');
    }

    if (!draftComplete(artifact)) {
      reasons.push('plan draft is not complete');
    }

    const blockingCount = env.blocking?.length || 0;

    if (blockingCount > 0) {
      reasons.push(`${blockingCount} blocking mechanical finding(s)`);
    }

    if (!env.semantic?.complete) {
      const missing = (env.semantic?.missing || []).join(', ');
      const failed = (env.semantic?.failed || []).join(', ');

      reasons.push(
        `semantic validation incomplete (missing: ${missing || 'none'}, failed: ${failed || 'none'})`
      );
    }

    if (!deltaComplete(artifact)) {
      reasons.push('delta is not complete');
    }

    return {
      ready: reasons.length === 0,
      reasons,
    };
  },

  getData(env) {
    const artifact = env.artifact || {};

    return {
      based_on_design: artifact?.metadata?.based_on_design || null,
      based_on_requirements:
        artifact?.metadata?.based_on_requirements || null,
      draft_complete: draftComplete(artifact),
      mechanical_valid: (env.blocking?.length || 0) === 0,
      semantic_complete: Boolean(env.semantic?.complete),
      delta_complete: deltaComplete(artifact),
    };
  },
};
