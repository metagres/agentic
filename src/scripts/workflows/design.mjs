import path from 'node:path';

import { today, nextIdsFromArrays } from '../lib/ids.mjs';
import { safeReadYaml } from '../lib/context.mjs';

import { deltaComplete, titleFromRequest, baseVersion } from '../lib/stage-helpers.mjs';



function draftComplete(artifact) {
  const hasContext = Boolean(
    artifact?.context_summary && String(artifact.context_summary).trim()
  );

  const components = Array.isArray(artifact?.components)
    ? artifact.components.length
    : 0;

  const decisions = Array.isArray(artifact?.decisions)
    ? artifact.decisions.length
    : 0;

  const traceability = Array.isArray(artifact?.traceability)
    ? artifact.traceability.length
    : 0;

  return hasContext && components > 0 && decisions > 0 && traceability > 0;
}

export const designStage = {
  id: 'design',
  artifactFile: 'design.yaml',
  contractFile: 'design-contract.yaml',
  deltaPhase: 'Design',

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
Ask the user which change directory to design.
`.trim(),
      commands: ['{{SDLC}} design --dir <change-dir>'],
    },

    init: {
      title: 'Initialization',
      next_action: 'initialize_context',
      markdown: `
The script created the initial design artifact.

Ensure requirements.yaml exists and has a version.
`.trim(),
      commands: ['{{SDLC}} design --dir {{change_dir}}'],
    },

    drafting: {
      title: 'Drafting',
      next_action: 'update_artifact',
      markdown: `
Draft the design artifact.

Use \`data.next_ids\` to choose the next CMP/DM/API/DEC ids.
`.trim(),
      commands: [
        '{{SDLC}} design --dir {{change_dir}} --next-ids',
        '{{SDLC}} design --dir {{change_dir}} --update-artifact < design.yaml',
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
        '{{SDLC}} design --dir {{change_dir}} --record-semantic-result --check <check_id> --status pass --evidence "<evidence>"',
      ],
    },

    delta: {
      title: 'Delta',
      next_action: 'append_delta_or_complete_step',
      markdown: `
Determine which living docs are affected by the design.

Use \`data.delta_allowed_target_docs\`.
`.trim(),
      commands: [
        '{{SDLC}} design --dir {{change_dir}} --append-delta < delta.yaml',
        '{{SDLC}} design --dir {{change_dir}} --complete-step --step delta',
      ],
    },

    recovery: {
      title: 'Recovery',
      next_action: 'fix_review_findings',
      markdown: `
The design artifact was rejected by review.

Read \`data.review_report\`, fix blocking findings, update the artifact, and finalize again.
`.trim(),
      commands: [
        '{{SDLC}} design --dir {{change_dir}} --update-artifact < design.yaml',
        '{{SDLC}} design --dir {{change_dir}} --finalize',
      ],
    },

    ready: {
      title: 'Ready',
      next_action: 'finalize',
      markdown: `
All gates passed.

Finalize the design artifact.
`.trim(),
      commands: ['{{SDLC}} design --dir {{change_dir}} --finalize'],
    },

    complete: {
      title: 'Complete',
      next_action: 'invoke_review',
      markdown: `
The design artifact is ready for the review gate.
`.trim(),
      commands: ['{{SDLC}} review --target design --dir {{change_dir}}'],
    },
  },

  initialArtifact(request, env) {
    const requirementsVersion = baseVersion(
      env.changeRoot,
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
      semantic_validation: [],
    };
  },

  nextIds(artifact) {
    return nextIdsFromArrays(artifact, {
      CMP: 'components',
      DM: 'data_models',
      API: 'apis',
      DEC: 'decisions',
    });
  },

  preconditionWarnings(env) {
    const warnings = [];

    if (!env.changeRoot) return warnings;

    const requirements = safeReadYaml(
      path.join(env.changeRoot, 'requirements.yaml')
    );

    if (requirements) {
      const status = requirements?.metadata?.status;

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
  },

  detectStep(env) {
    if (!env.changeRoot) return 'needs_input';

    const artifact = env.artifact;

    if (!artifact) return 'init';

    if (artifact.metadata?.status === 'rejected') return 'recovery';

    if (!artifact.metadata?.based_on_requirements) return 'init';

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

    if (!artifact?.metadata?.based_on_requirements) {
      reasons.push('design is not based on a requirements artifact version');
    }

    if (!draftComplete(artifact)) {
      reasons.push('design draft is not complete');
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
      based_on_requirements: artifact?.metadata?.based_on_requirements || null,
      draft_complete: draftComplete(artifact),
      mechanical_valid: (env.blocking?.length || 0) === 0,
      semantic_complete: Boolean(env.semantic?.complete),
      delta_complete: deltaComplete(artifact),
    };
  },
};
