import type { StepDefinition } from '../lib/types.ts';

export const skillManifest = {
  id: 'agentic-sdlc',
  title: 'Agentic SDLC',
  description:
    'Manages the full SDLC lifecycle via the sdlc CLI — requirements, design, ' +
    'planning, implementation, review, feedback, knowledge-extraction. ' +
    'Run scripts/sdlc.js status and follow the instructions field.',
};

export const stepDefinitionsByWorkflow: Record<string, Record<string, StepDefinition>> = {
  requirements: {
    needs_input: {
      title: 'Needs input',
      next_action: 'provide_change_or_request',
      markdown: `
Ask the user whether this is an existing change or a new request.

For an existing change, present \`data.existing_changes\` and ask the user to choose one.

For a new request, ask the user for the request text.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir <change-dir>',
        '{{SDLC}} requirements --request "<request text>"',
      ],
    },

    init: {
      title: 'Initialization',
      next_action: 'initialize_context',
      markdown: `
The script created the initial requirements artifact.

Read \`docs/current/index.md\` and use it to decide which living docs are relevant.
Read only what is needed for this request.
`.trim(),
      commands: ['{{SDLC}} requirements --dir {{change_dir}}'],
    },

    discovery: {
      title: 'Discovery',
      next_action: 'ask_user_question',
      markdown: `
Ask the user one question at a time.

Record each resolved answer through the script. The script allocates the next DL-NNN id.

Do not stop until \`data.discovery_gate.passed\` is true.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --record-answer --lens <lens> --question "<question>" --answer "<answer>"',
        '{{SDLC}} requirements --dir {{change_dir}} --set-clarity <clear|partial|vague>',
      ],
      exit_criteria: {
        field: 'data.discovery_gate.passed',
        equals: true,
      },
    },

    assumptions: {
      title: 'Assumptions',
      next_action: 'record_assumptions_or_complete_step',
      markdown: `
List every assumption implied by the request and discovery answers.

Classify each assumption as verified or unverified.

If there are genuinely no assumptions, mark the step complete.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --update-artifact < requirements.yaml',
        '{{SDLC}} requirements --dir {{change_dir}} --complete-step --step assumptions',
      ],
    },

    drafting: {
      title: 'Drafting',
      next_action: 'update_artifact',
      markdown: `
Draft the full requirements artifact.

Use \`data.next_ids\` to choose the next FR/NFR/AC ids.

Write the artifact through the script.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --next-ids',
        '{{SDLC}} requirements --dir {{change_dir}} --update-artifact < requirements.yaml',
      ],
    },

    validation: {
      title: 'Validation',
      next_action: 'fix_mechanical_errors',
      markdown: `
Fix mechanical validation errors first.

Then run \`--finalize\` to review the semantic checks.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --finalize',
      ],
    },

    delta: {
      title: 'Delta',
      next_action: 'append_delta_or_complete_step',
      markdown: `
Determine which living docs are affected.

Use \`data.delta_allowed_target_docs\` as the allowed target docs.

Append delta entries through the script.

If no docs are affected, mark the step complete.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --append-delta < delta.yaml',
        '{{SDLC}} requirements --dir {{change_dir}} --complete-step --step delta',
      ],
    },

    recovery: {
      title: 'Recovery',
      next_action: 'fix_review_findings',
      markdown: `
The artifact was rejected by review.

Read \`data.review_report\` and fix each blocking finding.

Update the artifact through the script, then finalize again.

If the artifact was rejected, finalizing automatically applies a patch version bump unless you pass --bump-version.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --update-artifact < requirements.yaml',
        '{{SDLC}} requirements --dir {{change_dir}} --finalize',
      ],
    },

    ready: {
      title: 'Ready',
      next_action: 'finalize',
      markdown: `
All gates passed.

Finalize the artifact.
`.trim(),
      commands: ['{{SDLC}} requirements --dir {{change_dir}} --finalize'],
    },

    complete: {
      title: 'Complete',
      next_action: 'invoke_review',
      markdown: `
The requirements artifact is ready for the review gate.
`.trim(),
      commands: ['{{SDLC}} review --target requirements --dir {{change_dir}}'],
    },
  },

  design: {
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
      next_action: 'fix_mechanical_errors',
      markdown: `
Fix mechanical validation errors first.

Then run \`--finalize\` to review the semantic checks.
`.trim(),
      commands: [
        '{{SDLC}} design --dir {{change_dir}} --finalize',
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

  planning: {
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
      next_action: 'fix_mechanical_errors',
      markdown: `
Fix mechanical validation errors first.

Then run \`--finalize\` to review the semantic checks.
`.trim(),
      commands: [
        '{{SDLC}} planning --dir {{change_dir}} --finalize',
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
};

export function getStepDefinitions(workflowId: string): Record<string, StepDefinition> | null {
  return stepDefinitionsByWorkflow[workflowId] || null;
}
