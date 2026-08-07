import type { StepDefinition } from '../lib/types.ts';

export const skillDefinitions = [
  {
    id: 'requirements-authoring',
    workflow: 'requirements',
    title: 'Requirements Authoring',
    description: 'Creates structured requirements.yaml artifacts with traceable FR/NFR/AC IDs.',
    overview: 'This skill drives the requirements stage. The CLI owns step detection, artifact status, validation, and finalization.',
    steps: [
      { name: 'needs_input', text: 'Choose an existing change directory or provide a new request.' },
      { name: 'init', text: 'Initialize the requirements artifact and read relevant living docs.' },
      { name: 'discovery', text: 'Ask one question at a time and record answers until the discovery gate passes.' },
      { name: 'assumptions', text: 'List and classify assumptions. Mark the step complete only if none remain.' },
      { name: 'drafting', text: 'Draft FRs, NFRs, and ACs. Use data.next_ids for new IDs.' },
      { name: 'validation', text: 'Fix mechanical findings. The CLI will inject semantic checks to review.' },
      { name: 'delta', text: 'Add docs/current delta entries for affected living docs.' },
      { name: 'recovery', text: 'If rejected, fix findings from the review file and finalize again.' },
      { name: 'ready', text: 'All gates passed. Finalize the artifact.' },
      { name: 'complete', text: 'The artifact is ready for review.' },
    ],
    commands: [
      'node "$SDLC_CLI" requirements --dir <change-dir>',
      'node "$SDLC_CLI" requirements --request "<request text>"',
      'node "$SDLC_CLI" requirements --dir <change-dir> --next-ids',
      'node "$SDLC_CLI" requirements --dir <change-dir> --record-answer --lens <lens> --question "<question>" --answer "<answer>"',
      'node "$SDLC_CLI" requirements --dir <change-dir> --set-clarity <clear|partial|vague>',
      'node "$SDLC_CLI" requirements --dir <change-dir> --update-artifact < requirements.yaml',
      'node "$SDLC_CLI" requirements --dir <change-dir> --append-delta < delta.yaml',
      'node "$SDLC_CLI" requirements --dir <change-dir> --complete-step --step assumptions',
      'node "$SDLC_CLI" requirements --dir <change-dir> --finalize',
      'node "$SDLC_CLI" requirements --dir <change-dir> --finalize --confirm-semantic',
    ],
    stepDefinitions: {
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
    } as Record<string, StepDefinition>,
  },
  {
    id: 'design-authoring',
    workflow: 'design',
    title: 'Design Authoring',
    description: 'Creates structured design.yaml artifacts from requirements.yaml.',
    overview: 'This skill drives the design stage. It produces components, data models, APIs, decisions, and traceability.',
    steps: [
      { name: 'needs_input', text: 'Choose the change directory to design.' },
      { name: 'init', text: 'Initialize design.yaml and pin it to requirements.yaml version.' },
      { name: 'drafting', text: 'Draft components, data models, APIs, decisions, and traceability.' },
      { name: 'validation', text: 'Fix mechanical findings. The CLI will inject semantic checks to review.' },
      { name: 'delta', text: 'Add docs/current delta entries for affected living docs.' },
      { name: 'recovery', text: 'If rejected, fix findings from design-review.yaml and finalize again.' },
      { name: 'ready', text: 'All gates passed. Finalize the artifact.' },
      { name: 'complete', text: 'The design artifact is ready for review.' },
    ],
    commands: [
      'node "$SDLC_CLI" design --dir <change-dir>',
      'node "$SDLC_CLI" design --dir <change-dir> --next-ids',
      'node "$SDLC_CLI" design --dir <change-dir> --update-artifact < design.yaml',
      'node "$SDLC_CLI" design --dir <change-dir> --append-delta < delta.yaml',
      'node "$SDLC_CLI" design --dir <change-dir> --finalize',
      'node "$SDLC_CLI" design --dir <change-dir> --finalize --confirm-semantic',
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
    } as Record<string, StepDefinition>,
  },
  {
    id: 'planning',
    workflow: 'planning',
    title: 'Planning',
    description: 'Creates structured plan.yaml artifacts from design.yaml and requirements.yaml.',
    overview: 'This skill drives the planning stage. It produces tasks, dependencies, requirement coverage, and file operation intent.',
    steps: [
      { name: 'needs_input', text: 'Choose the change directory to plan.' },
      { name: 'init', text: 'Initialize plan.yaml and pin it to design.yaml and requirements.yaml versions.' },
      { name: 'drafting', text: 'Draft tasks with covers, acceptance_ids, depends_on, files, and status.' },
      { name: 'validation', text: 'Fix mechanical findings. The CLI will inject semantic checks to review.' },
      { name: 'delta', text: 'Add docs/current delta entries for affected living docs.' },
      { name: 'recovery', text: 'If rejected, fix findings from plan-review.yaml and finalize again.' },
      { name: 'ready', text: 'All gates passed. Finalize the artifact.' },
      { name: 'complete', text: 'The plan artifact is ready for review.' },
    ],
    commands: [
      'node "$SDLC_CLI" planning --dir <change-dir>',
      'node "$SDLC_CLI" planning --dir <change-dir> --next-ids',
      'node "$SDLC_CLI" planning --dir <change-dir> --update-artifact < plan.yaml',
      'node "$SDLC_CLI" planning --dir <change-dir> --append-delta < delta.yaml',
      'node "$SDLC_CLI" planning --dir <change-dir> --finalize',
      'node "$SDLC_CLI" planning --dir <change-dir> --finalize --confirm-semantic',
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
    } as Record<string, StepDefinition>,
  },
  {
    id: 'implementation',
    workflow: 'implementation',
    title: 'Implementation',
    description: 'Updates task execution state in plan.yaml during implementation.',
    overview: 'This skill updates task status, notes, and changed files inside plan.yaml.',
    steps: [
      { name: 'progress', text: 'Show implementation progress from plan.yaml task state.' },
      { name: 'task_update', text: 'Update a task status, note, and files_changed.' },
      { name: 'ready', text: 'When all tasks are done or skipped, run implementation review.' },
    ],
    commands: [
      'node "$SDLC_CLI" implementation --dir <change-dir>',
      'node "$SDLC_CLI" implementation --dir <change-dir> --task-id TASK-001 --status in_progress --note "Started work"',
      'node "$SDLC_CLI" implementation --dir <change-dir> --task-id TASK-001 --status done --note "Implemented" --files "create:src/a.ts,modify:src/b.ts"',
      'node "$SDLC_CLI" review --target implementation --dir <change-dir> --accept',
    ],
  },
  {
    id: 'review',
    workflow: 'review',
    title: 'Review Gate',
    description: 'Reviews requirements.yaml, design.yaml, plan.yaml, or implementation state.',
    overview: 'This skill runs the review gate. It writes artifact-specific review files with review rounds and accepts or rejects the reviewed target.',
    steps: [
      { name: 'review', text: 'Run mechanical and semantic review against the target artifact.' },
    ],
    commands: [
      'node "$SDLC_CLI" review --target requirements --dir <change-dir> --accept',
      'node "$SDLC_CLI" review --target design --dir <change-dir> --accept',
      'node "$SDLC_CLI" review --target plan --dir <change-dir> --accept',
      'node "$SDLC_CLI" review --target implementation --dir <change-dir> --accept',
      'node "$SDLC_CLI" review --target requirements --dir <change-dir> --reject',
    ],
  },
  {
    id: 'feedback',
    workflow: 'feedback',
    title: 'Cross-Stage Feedback',
    description: 'Pauses the current stage and reverts a previous stage to draft for corrections.',
    overview: 'Use this skill when you find a flaw in an already-accepted previous stage (e.g., Design finds a flaw in Requirements).',
    steps: [
      { name: 'create', text: 'Revert the target stage to draft and block the current stage.' },
      { name: 'resolve', text: 'After fixing the target stage and re-reviewing it, resolve the feedback to unblock the current stage.' },
    ],
    commands: [
      'node "$SDLC_CLI" feedback --dir <change-dir> --from <current-stage> --to <previous-stage> --reason "..."',
      'node "$SDLC_CLI" feedback --dir <change-dir> --resolve <FB-id>',
    ],
  },
  {
    id: 'knowledge-extraction',
    workflow: 'knowledge-extraction',
    title: 'Knowledge Extraction',
    description: 'Synchronizes docs/current from approved changes using deltas.',
    overview: 'This skill lists the deltas to apply to docs/current. After updating the docs, mark extraction as complete.',
    steps: [
      { name: 'docs_delta', text: 'Read the deltas to apply from the CLI output.' },
      { name: 'updating_docs', text: 'Manually edit docs/current files to apply the deltas.' },
      { name: 'complete', text: 'Run the complete command to mark knowledge extraction as done.' },
    ],
    commands: [
      'node "$SDLC_CLI" knowledge-extraction --dir <change-dir>',
      'node "$SDLC_CLI" knowledge-extraction --dir <change-dir> --complete',
    ],
  },
];

export function getStepDefinitions(workflowId: string): Record<string, StepDefinition> | null {
  for (const skill of skillDefinitions) {
    if (skill.workflow === workflowId && skill.stepDefinitions) {
      return skill.stepDefinitions;
    }
  }
  return null;
}