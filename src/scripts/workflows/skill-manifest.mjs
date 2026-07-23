export const skillDefinitions = [
  {
    id: 'requirements-authoring',
    workflow: 'requirements',
    title: 'Requirements Authoring',
    description:
      'Creates structured requirements.yaml artifacts with traceable FR/NFR/AC IDs. ' +
      'Use when the user asks to write, capture, refine, or review requirements, ' +
      'define what to build, document a feature spec, or start a new change.',
    overview:
      'This skill drives the requirements stage. The CLI owns step detection, ' +
      'artifact status, validation, and finalization. The agent asks questions, ' +
      'interprets answers, drafts requirements, and records semantic evidence.',
    steps: [
      {
        name: 'needs_input',
        text: 'Choose an existing change directory or provide a new request.',
      },
      {
        name: 'init',
        text: 'Initialize the requirements artifact and read relevant living docs.',
      },
      {
        name: 'discovery',
        text: 'Ask one question at a time and record answers until the discovery gate passes.',
      },
      {
        name: 'assumptions',
        text: 'List and classify assumptions. Mark the step complete only if none remain.',
      },
      {
        name: 'drafting',
        text: 'Draft FRs, NFRs, and ACs. Use data.next_ids for new IDs.',
      },
      {
        name: 'validation',
        text: 'Fix mechanical findings, then record semantic check results with evidence.',
      },
      {
        name: 'delta',
        text: 'Add docs/current delta entries for affected living docs.',
      },
      {
        name: 'recovery',
        text: 'If rejected, fix findings from the review file and finalize again.',
      },
      {
        name: 'ready',
        text: 'All gates passed. Finalize the artifact.',
      },
      {
        name: 'complete',
        text: 'The artifact is ready for review.',
      },
    ],
    commands: [
      'node "$SDLC_CLI" requirements',
      'node "$SDLC_CLI" requirements --dir <change-dir>',
      'node "$SDLC_CLI" requirements --request "<request text>"',
      'node "$SDLC_CLI" requirements --dir <change-dir> --next-ids',
      'node "$SDLC_CLI" requirements --dir <change-dir> --record-answer --lens <lens> --question "<question>" --answer "<answer>"',
      'node "$SDLC_CLI" requirements --dir <change-dir> --set-clarity <clear|partial|vague>',
      'node "$SDLC_CLI" requirements --dir <change-dir> --update-artifact < requirements.yaml',
      'node "$SDLC_CLI" requirements --dir <change-dir> --record-semantic-result --check <check_id> --status pass --evidence "<evidence>"',
      'node "$SDLC_CLI" requirements --dir <change-dir> --append-delta < delta.yaml',
      'node "$SDLC_CLI" requirements --dir <change-dir> --complete-step --step assumptions',
      'node "$SDLC_CLI" requirements --dir <change-dir> --complete-step --step delta',
      'node "$SDLC_CLI" requirements --dir <change-dir> --finalize',
    ],
  },
  {
    id: 'design-authoring',
    workflow: 'design',
    title: 'Design Authoring',
    description:
      'Creates structured design.yaml artifacts from requirements.yaml. ' +
      'Use when the user asks to design a feature, produce a technical design, ' +
      'or convert requirements into architecture.',
    overview:
      'This skill drives the design stage. It produces components, data models, ' +
      'APIs, decisions, and traceability from requirements to design elements.',
    steps: [
      {
        name: 'needs_input',
        text: 'Choose the change directory to design.',
      },
      {
        name: 'init',
        text: 'Initialize design.yaml and pin it to requirements.yaml version.',
      },
      {
        name: 'drafting',
        text: 'Draft components, data models, APIs, decisions, and traceability.',
      },
      {
        name: 'validation',
        text: 'Fix mechanical findings, then record semantic check results with evidence.',
      },
      {
        name: 'delta',
        text: 'Add docs/current delta entries for affected living docs.',
      },
      {
        name: 'recovery',
        text: 'If rejected, fix findings from design-review.yaml and finalize again.',
      },
      {
        name: 'ready',
        text: 'All gates passed. Finalize the artifact.',
      },
      {
        name: 'complete',
        text: 'The design artifact is ready for review.',
      },
    ],
    commands: [
      'node "$SDLC_CLI" design --dir <change-dir>',
      'node "$SDLC_CLI" design --dir <change-dir> --next-ids',
      'node "$SDLC_CLI" design --dir <change-dir> --update-artifact < design.yaml',
      'node "$SDLC_CLI" design --dir <change-dir> --record-semantic-result --check <check_id> --status pass --evidence "<evidence>"',
      'node "$SDLC_CLI" design --dir <change-dir> --append-delta < delta.yaml',
      'node "$SDLC_CLI" design --dir <change-dir> --complete-step --step delta',
      'node "$SDLC_CLI" design --dir <change-dir> --finalize',
    ],
  },
  {
    id: 'planning',
    workflow: 'planning',
    title: 'Planning',
    description:
      'Creates structured plan.yaml artifacts from design.yaml and requirements.yaml. ' +
      'Use when the user asks to plan implementation, break design into tasks, ' +
      'or prepare work for an AI coding agent.',
    overview:
      'This skill drives the planning stage. It produces tasks, dependencies, ' +
      'requirement coverage, acceptance traceability, and file operation intent.',
    steps: [
      {
        name: 'needs_input',
        text: 'Choose the change directory to plan.',
      },
      {
        name: 'init',
        text: 'Initialize plan.yaml and pin it to design.yaml and requirements.yaml versions.',
      },
      {
        name: 'drafting',
        text: 'Draft tasks with covers, acceptance_ids, depends_on, files, and status.',
      },
      {
        name: 'validation',
        text: 'Fix mechanical findings, then record semantic check results with evidence.',
      },
      {
        name: 'delta',
        text: 'Add docs/current delta entries for affected living docs.',
      },
      {
        name: 'recovery',
        text: 'If rejected, fix findings from plan-review.yaml and finalize again.',
      },
      {
        name: 'ready',
        text: 'All gates passed. Finalize the artifact.',
      },
      {
        name: 'complete',
        text: 'The plan artifact is ready for review.',
      },
    ],
    commands: [
      'node "$SDLC_CLI" planning --dir <change-dir>',
      'node "$SDLC_CLI" planning --dir <change-dir> --next-ids',
      'node "$SDLC_CLI" planning --dir <change-dir> --update-artifact < plan.yaml',
      'node "$SDLC_CLI" planning --dir <change-dir> --record-semantic-result --check <check_id> --status pass --evidence "<evidence>"',
      'node "$SDLC_CLI" planning --dir <change-dir> --append-delta < delta.yaml',
      'node "$SDLC_CLI" planning --dir <change-dir> --complete-step --step delta',
      'node "$SDLC_CLI" planning --dir <change-dir> --finalize',
    ],
  },
  {
    id: 'implementation',
    workflow: 'implementation',
    title: 'Implementation',
    description:
      'Updates task execution state in plan.yaml during implementation. ' +
      'Use when the user asks to implement a plan, execute tasks, or continue coding work.',
    overview:
      'This skill updates task status, notes, and changed files inside plan.yaml. ' +
      'It also reminds the agent of planning quality guardrails during implementation.',
    steps: [
      {
        name: 'progress',
        text: 'Show implementation progress from plan.yaml task state.',
      },
      {
        name: 'task_update',
        text: 'Update a task status, note, and files_changed.',
      },
      {
        name: 'ready',
        text: 'When all tasks are done or skipped, run implementation review.',
      },
    ],
    commands: [
      'node "$SDLC_CLI" implementation --dir <change-dir>',
      'node "$SDLC_CLI" implementation --dir <change-dir> --task-id TASK-001 --status in_progress --note "Started work"',
      'node "$SDLC_CLI" implementation --dir <change-dir> --task-id TASK-001 --status done --note "Implemented and verified" --files "create:src/a.js,modify:src/b.js"',
      'node "$SDLC_CLI" review --target implementation --dir <change-dir>',
    ],
  },
  {
    id: 'review',
    workflow: 'review',
    title: 'Review Gate',
    description:
      'Reviews requirements.yaml, design.yaml, plan.yaml, or implementation state. ' +
      'Use when a stage artifact is ready-for-review or when implementation is complete.',
    overview:
      'This skill runs the review gate. It writes artifact-specific review files ' +
      'with review rounds and accepts or rejects the reviewed target.',
    steps: [
      {
        name: 'review',
        text: 'Run mechanical and semantic review against the target artifact.',
      },
    ],
    commands: [
      'node "$SDLC_CLI" review --target requirements --dir <change-dir>',
      'node "$SDLC_CLI" review --target design --dir <change-dir>',
      'node "$SDLC_CLI" review --target plan --dir <change-dir>',
      'node "$SDLC_CLI" review --target implementation --dir <change-dir>',
      'node "$SDLC_CLI" review --target requirements --dir <change-dir> --accept',
      'node "$SDLC_CLI" review --target requirements --dir <change-dir> --reject',
      'node "$SDLC_CLI" review --target design --dir <change-dir> --accept',
      'node "$SDLC_CLI" review --target design --dir <change-dir> --reject',
      'node "$SDLC_CLI" review --target plan --dir <change-dir> --accept',
      'node "$SDLC_CLI" review --target plan --dir <change-dir> --reject',
      'node "$SDLC_CLI" review --target implementation --dir <change-dir> --accept',
      'node "$SDLC_CLI" review --target implementation --dir <change-dir> --reject',
    ],
  },
  {
    id: 'knowledge-extraction',
    workflow: 'knowledge-extraction',
    title: 'Knowledge Extraction',
    description:
      'Synchronizes docs/current from approved changes using docs-delta.yaml. ' +
      'Use after implementation review to update living documentation.',
    overview:
      'This skill aggregates delta entries from requirements, design, and planning, ' +
      'then guides documentation updates in docs/current. It tracks extraction state ' +
      'in docs-delta.yaml.',
    steps: [
      {
        name: 'docs_delta',
        text: 'Generate or inspect docs-delta.yaml from stage artifacts.',
      },
      {
        name: 'updating_docs',
        text: 'Update docs/current and mark entries extracted with notes.',
      },
      {
        name: 'complete',
        text: 'Complete knowledge extraction when all entries are extracted and valid.',
      },
    ],
    commands: [
      'node "$SDLC_CLI" knowledge-extraction --dir <change-dir>',
      'node "$SDLC_CLI" docs --dir <change-dir>',
      'node "$SDLC_CLI" knowledge-extraction --dir <change-dir> --mark-extracted --entry-id <DD-...> --note "Updated section..."',
      'node "$SDLC_CLI" knowledge-extraction --dir <change-dir> --mark-extracted --target-doc docs/current/api.md --note "Updated API section..."',
      'node "$SDLC_CLI" knowledge-extraction --dir <change-dir> --complete',
    ],
  },
];