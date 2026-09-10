import { CWD_FLAG_DOC, writeJson, EXIT } from './cli.ts';

/**
 * Help contract (FR-010, DEC-006): one builder renders every command's
 * --help envelope with copy-pasteable usage patterns and a flags map, and
 * the same per-command flag tables feed the closed-vocabulary guard
 * (FR-009). The tables are the single source: help renders them, the guard
 * enforces them, and the completeness tests bind parsed flags to documented
 * flags.
 */

export interface FlagDoc {
  description: string;
  /** Value shape: '<change-name>', '[file|-]', '(flag)' for booleans. */
  value: string;
  required?: boolean;
}

export type FlagTable = Record<string, FlagDoc>;

export function helpEnvelope(params: {
  command: string;
  purpose: string;
  usage: string[];
  flags: FlagTable;
  extraData?: Record<string, unknown>;
}): Record<string, unknown> {
  const flags = {
    ...params.flags,
    cwd: {
      description:
        'Run as if invoked from the given project root (default: the current working directory).',
      value: '<project-root>',
    },
  };

  const instructions = [
    params.purpose,
    '',
    ...params.usage.map((line) => `  ${line}`),
    '',
    CWD_FLAG_DOC,
  ].join('\n');

  return {
    command: params.command,
    step: 'help',
    state: 'ok',
    instructions,
    data: {
      usage: params.usage,
      flags,
      ...(params.extraData || {}),
    },
    errors: [],
    warnings: [],
  };
}

/**
 * Closed-vocabulary guard (FR-009): refuses flags outside the command's
 * declared table before any command effect. Exits through writeJson with
 * the usage code naming every unknown flag.
 */
export function rejectUnknownFlags(
  command: string,
  args: Record<string, unknown>,
  table: FlagTable
): void {
  const unknown = Object.keys(args).filter(
    (key) => key !== '_' && key !== 'help' && !(key in table) && key !== 'cwd'
  );

  if (unknown.length === 0) return;

  writeJson(
    {
      command,
      step: 'blocked',
      state: 'blocked',
      instructions: `Unknown flag --${unknown[0]} for '${command}'. Run sdlc ${command} --help for the flags map.`,
      data: { unknown_flags: unknown.map((flag) => `--${flag}`) },
      errors: [
        {
          code: 'UNKNOWN_FLAG',
          message: `Unknown flag '--${unknown[0]}' for '${command}'.`,
          fix: 'Check the flags map with --help and retry with declared flags only.',
        },
      ],
      warnings: [],
    },
    EXIT.usage
  );
}

// ---------------------------------------------------------------------------
// Per-command flag tables (DEC-006): declared once, rendered by --help and
// enforced by rejectUnknownFlags.
// ---------------------------------------------------------------------------

export const AUTHORING_FLAGS: FlagTable = {
  change: {
    description: 'Work on an existing change (fuzzy name resolution). With --request and no match, creates the change under the exact slug.',
    value: '<change-name>',
  },
  request: {
    description: 'Start a new change from the request text (or create under --change when combined).',
    value: '<request>',
  },
  'update-artifact': {
    description: 'Upsert the stage artifact from YAML: creates it when missing, then merges; reads stdin by default or the given file. Id-keyed object lists merge per entry.',
    value: '[file|-]',
  },
  'append-delta': {
    description: 'Append validated delta entries to the artifact delta array from stdin or a file.',
    value: '[file|-]',
  },
  'record-answer': {
    description: 'Record one discovery answer (hook-backed: the stage must implement recordAnswer).',
    value: '(with --lens/--question/--answer)',
  },
  lens: {
    description: 'Discovery lens for --record-answer.',
    value: '<lens>',
  },
  question: {
    description: 'Discovery question for --record-answer.',
    value: '<question>',
  },
  answer: {
    description: 'Discovery answer for --record-answer.',
    value: '<answer>',
  },
  'record-answers': {
    description: 'Batch-record discovery answers from a YAML array of {lens, question, answer}.',
    value: '<file|->',
  },
  'set-clarity': {
    description: 'Set the overall clarity label (hook-backed: the stage must implement setClarity).',
    value: '<clear|partial|vague>',
  },
  'complete-step': {
    description: 'Manually complete a confirmable step.',
    value: '(with --step)',
  },
  step: {
    description: 'Step id for --complete-step.',
    value: '<step>',
  },
  finalize: {
    description: 'Set the artifact ready-for-review after mechanical validation; bumps the version mechanically.',
    value: '(flag)',
  },
  'confirm-semantic': {
    description: 'With --finalize: confirm the semantic checklist was verified.',
    value: '(flag)',
  },
  lint: {
    description: 'Run mechanical validation only and return the findings without writing anything.',
    value: '(flag)',
  },
  'help-step': {
    description: 'Include the current step guidance (title, markdown, commands, exit criteria) in data.step_help.',
    value: '(flag)',
  },
  describe: {
    description: 'Print the stage description (steps, artifact) without a change.',
    value: '(flag)',
  },
  'describe-step': {
    description: 'Print one step definition.',
    value: '<step>',
  },
};

export const REVIEW_FLAGS: FlagTable = {
  change: {
    description: 'Review the tracked artifact of this review stage on the given change.',
    value: '<change-name>',
    required: true,
  },
  accept: {
    description: 'Record an accepted verdict; refused while mechanical findings exist.',
    value: '(flag)',
  },
  reject: {
    description: 'Record a rejected verdict; with passing mechanical checks requires --failures.',
    value: '(flag)',
  },
  failures: {
    description: 'YAML list of {check, evidence} semantic failures; - reads stdin.',
    value: '<file|->',
  },
  'list-semantic-checks': {
    description: 'Print the declared semantic checks without opening or writing a round.',
    value: '(flag)',
  },
  'dry-run': {
    description: 'Compute the round result without opening or writing it.',
    value: '(flag)',
  },
  'help-step': {
    description: 'Include the current step guidance.',
    value: '(flag)',
  },
};

export const TASKS_FLAGS: FlagTable = {
  change: {
    description: 'Work on the plan of the given change.',
    value: '<change-name>',
    required: true,
  },
  'task-id': {
    description: 'Task to update (with --status).',
    value: '<TASK-NNN>',
  },
  status: {
    description: 'New task status: pending, in_progress, done, blocked, skipped. done requires --note.',
    value: '<status>',
  },
  note: {
    description: 'Implementation note; required for done.',
    value: '<note>',
  },
  files: {
    description: 'Changed or planned files as comma-separated op:path entries (create, modify, delete).',
    value: '<entries>',
  },
  'task-add': {
    description: 'Append a new pending task with the next id; requires --covers and --acceptance-ids.',
    value: '<title>',
  },
  covers: {
    description: 'Comma-separated FR/NFR ids the new task carries (required by --task-add).',
    value: '<FR-NNN,...>',
  },
  'acceptance-ids': {
    description: 'Comma-separated AC ids the new task verifies (required by --task-add).',
    value: '<AC-NNN,...>',
  },
  description: {
    description: 'Task description for --task-add.',
    value: '<text>',
  },
  'depends-on': {
    description: 'Comma-separated task ids the new task depends on (validated against known ids).',
    value: '<TASK-NNN,...>',
  },
  complexity: {
    description: 'Optional complexity for --task-add: low, medium, or high.',
    value: '<low|medium|high>',
  },
  'task-remove': {
    description: 'Remove a task; done tasks are refused.',
    value: '<TASK-NNN>',
  },
  'help-step': {
    description: 'Include the current step guidance.',
    value: '(flag)',
  },
};

export const AGGREGATOR_FLAGS: FlagTable = {
  change: {
    description: 'Synchronize the living docs for the given change.',
    value: '<change-name>',
    required: true,
  },
  complete: {
    description: 'Write docs-delta.yaml and mark the synchronization complete after deltas are applied.',
    value: '(flag)',
  },
  'help-step': {
    description: 'Include the current step guidance.',
    value: '(flag)',
  },
};

export const STATUS_FLAGS: FlagTable = {
  change: {
    description: 'Show the pipeline state for the given change.',
    value: '<change-name>',
    required: true,
  },
};

export const CHANGES_FLAGS: FlagTable = {};

export const FEEDBACK_FLAGS: FlagTable = {
  change: {
    description: 'Operate on the feedback store of the given change.',
    value: '<change-name>',
    required: true,
  },
  from: {
    description: 'Stage where the problem surfaced (creation).',
    value: '<stage>',
  },
  to: {
    description: 'Stage to revert to draft; must precede --from in the requires graph.',
    value: '<stage>',
  },
  reason: {
    description: 'Evidence-backed reason for the feedback entry.',
    value: '<text>',
  },
  resolve: {
    description: 'Resolve one open feedback entry by id and unblock its from-stage.',
    value: '<FB-id>',
  },
  list: {
    description: 'List every feedback entry read-only.',
    value: '(flag)',
  },
};

export const DOCTOR_FLAGS: FlagTable = {
  strict: {
    description: 'Treat warnings as failures.',
    value: '(flag)',
  },
  change: {
    description: 'Restrict the docs-index and change-related checks to the given change.',
    value: '<change-name>',
  },
};
