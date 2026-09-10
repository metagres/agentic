import path from 'node:path';

import type { StageRecord } from '../stage-registry.ts';
import { parseArgs, writeJson, EXIT, CWD_FLAG_DOC } from '../cli.ts';
import { writeYamlAtomic } from '../yaml-io.ts';
import { safeReadYaml } from '../context.ts';
import { requireChangeRoot } from '../change-root.ts';
import { today } from '../ids.ts';
import { makeError } from '../error-catalog.ts';
import { helpEnvelope, rejectUnknownFlags, TASKS_FLAGS } from '../help.ts';
import { evaluateGate } from '../requires-graph.ts';
import { loadStepDefinitions } from '../steps-loader.ts';
import { buildStepVars, renderStepHelp, renderTemplate } from '../step-render.ts';
import type { ParseArgsResult, WarningItem } from '../types.ts';

const ALLOWED_TASK_STATUS = [
  'pending',
  'in_progress',
  'done',
  'blocked',
  'skipped',
];

function usage(stage: StageRecord, code = EXIT.ok) {
  if (code === EXIT.ok) {
    writeJson(
      helpEnvelope({
        workflow: stage.id,
        purpose:
          'Implementation stage: update task status and manage the task list of the accepted plan.',
        usage: [
          `sdlc ${stage.id} --change <change-name>`,
          `sdlc ${stage.id} --change <change-name> --task-id TASK-001 --status in_progress --note "..." --files "create:src/a.ts,modify:src/b.ts"`,
          `sdlc ${stage.id} --change <change-name> --task-add "Title" --covers FR-001 --acceptance-ids AC-001 --description "..." --depends-on TASK-001 --files "..."`,
          `sdlc ${stage.id} --change <change-name> --task-remove TASK-002`,
        ],
        flags: TASKS_FLAGS,
        extraData: { allowed_task_status: ALLOWED_TASK_STATUS },
      }),
      code
    );
    return;
  }

  writeJson(
    {
      workflow: stage.id,
      step: 'help',
      state: 'blocked',
      instructions:
        `Usage: sdlc ${stage.id} --change <change-name> ` +
        '[--task-id TASK-001 --status in_progress --note "..." --files "create:src/a.ts,modify:src/b.ts"] ' +
        '[--task-add "Title" --covers FR-001 --acceptance-ids AC-001 --description "..." --depends-on TASK-001 --files "..."] ' +
        '[--task-remove TASK-002] ' +
        CWD_FLAG_DOC,
      data: {
        allowed_task_status: ALLOWED_TASK_STATUS,
      },
      errors: [],
      warnings: [],
    },
    code
  );
}

function parseFiles(filesArg: string) {
  if (!filesArg) return [];

  return String(filesArg)
    .split(',')
    .map((entry: string) => entry.trim())
    .filter(Boolean)
    .map((entry: string) => {
      const idx = entry.indexOf(':');

      if (idx === -1) {
        return { path: entry, operation: 'modify' };
      }

      const maybeOp = entry.slice(0, idx);
      const rest = entry.slice(idx + 1);

      if (['create', 'modify', 'delete'].includes(maybeOp)) {
        return { path: rest, operation: maybeOp };
      }

      return { path: entry, operation: 'modify' };
    });
}

function computeProgress(plan: Record<string, unknown>) {
  const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Record<string, unknown>[];

  const counts: Record<string, number> = {
    total: tasks.length,
    pending: 0,
    in_progress: 0,
    done: 0,
    blocked: 0,
    skipped: 0,
  };

  const statusById = new Map<string, string>();

  for (const task of tasks) {
    const status = (task?.status as string) || 'pending';
    statusById.set(task?.id as string, status);
    if (counts[status] !== undefined) {
      counts[status] += 1;
    }
  }

  const nextTaskIds = tasks
    .filter((task: Record<string, unknown>) => {
      const status = (task?.status as string) || 'pending';
      const deps = (Array.isArray(task?.depends_on) ? task.depends_on : []) as string[];
      return (
        status === 'pending' &&
        deps.every((dep: string) => statusById.get(dep) === 'done')
      );
    })
    .map((task: Record<string, unknown>) => task.id as string);

  return {
    total: counts.total,
    pending: counts.pending,
    in_progress: counts.in_progress,
    done: counts.done,
    blocked: counts.blocked,
    skipped: counts.skipped,
    complete: counts.total > 0 && counts.done + counts.skipped === counts.total,
    next_task_ids: nextTaskIds,
  };
}

type TaskMutationResult =
  | { blocked: Record<string, unknown>; exit: number }
  | { taskId: string };

function blockedEnvelope(
  ctx: { changeRoot: string; planPath: string },
  instructions: string,
  error: ReturnType<typeof makeError>,
  exit: number,
  extraData: Record<string, unknown> = {}
): { blocked: Record<string, unknown>; exit: number } {
  return {
    blocked: {
      state: 'blocked',
      instructions,
      data: {
        change_root: ctx.changeRoot,
        plan: ctx.planPath,
        ...extraData,
      },
      errors: [error],
      warnings: [],
    },
    exit,
  };
}

function nextTaskId(tasks: Record<string, unknown>[]): string {
  let max = 0;
  for (const task of tasks) {
    const id = String(task?.id ?? '');
    if (id.startsWith('TASK-')) {
      const n = Number(id.slice(5));
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return `TASK-${String(max + 1).padStart(3, '0')}`;
}

function splitList(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function applyTaskAdd(
  plan: Record<string, unknown>,
  titleArg: string,
  args: Record<string, unknown>,
  ctx: { changeRoot: string; planPath: string }
): TaskMutationResult {
  const title = String(titleArg ?? '').trim();
  const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Record<string, unknown>[];

  if (!title) {
    return blockedEnvelope(
      ctx,
      '--task-add requires a non-empty title.',
      makeError('USAGE', { message: '--task-add requires a non-empty title.' }),
      EXIT.usage
    );
  }

  const covers = splitList(args['covers']);
  const acceptanceIds = splitList(args['acceptance-ids']);

  if (covers.length === 0 || acceptanceIds.length === 0) {
    return blockedEnvelope(
      ctx,
      '--task-add requires --covers and --acceptance-ids: a task must verify at least one acceptance criterion of the requirements it covers.',
      makeError('USAGE', {
        message: '--task-add requires --covers and --acceptance-ids.',
      }),
      EXIT.usage
    );
  }

  const dependsOn = splitList(args['depends-on']);
  const knownIds = tasks.map((task) => String(task?.id ?? '')).filter(Boolean);
  const unknown = dependsOn.filter((dep) => !knownIds.includes(dep));

  if (unknown.length > 0) {
    return blockedEnvelope(
      ctx,
      `Unknown depends_on id(s): ${unknown.join(', ')}.`,
      makeError('TASK_DEPENDS_ON_UNKNOWN', {
        message: `Unknown depends_on id(s): ${unknown.join(', ')}`,
        fix: 'Use task ids from data.known_task_ids.',
      }),
      EXIT.usage,
      { known_task_ids: knownIds, requested_depends_on: dependsOn }
    );
  }

  const task: Record<string, unknown> = {
    id: nextTaskId(tasks),
    title,
    description: String(args.description ?? '').trim(),
    type: 'implementation',
    status: 'pending',
    covers,
    acceptance_ids: acceptanceIds,
  };

  if (args.complexity) task.complexity = String(args.complexity);
  if (dependsOn.length > 0) task.depends_on = dependsOn;

  if (args.files) {
    task.files = parseFiles(String(args.files));
  }

  (plan.tasks as Record<string, unknown>[]).push(task);
  return { taskId: String(task.id) };
}

function applyTaskRemove(
  plan: Record<string, unknown>,
  taskId: string,
  ctx: { changeRoot: string; planPath: string }
): TaskMutationResult {
  const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Record<string, unknown>[];
  const index = tasks.findIndex((task) => String(task?.id ?? '') === taskId);

  if (index === -1) {
    return blockedEnvelope(
      ctx,
      `Task ${taskId} was not found in plan.yaml.`,
      makeError('TASK_NOT_FOUND', { message: `Task ${taskId} not found in plan.yaml.` }),
      EXIT.actionFailed,
      {
        task_id: taskId,
        known_task_ids: tasks.map((task) => String(task?.id ?? '')).filter(Boolean),
      }
    );
  }

  if (String(tasks[index].status) === 'done') {
    return blockedEnvelope(
      ctx,
      `Task ${taskId} is done and cannot be removed: the implementation record stays in the plan.`,
      makeError('TASK_REMOVE_NOT_ALLOWED', {
        message: `Task ${taskId} is done; done tasks cannot be removed.`,
        fix: 'Mark the task skipped instead, or keep the record.',
      }),
      EXIT.actionFailed,
      { task_id: taskId }
    );
  }

  tasks.splice(index, 1);
  return { taskId };
}

export async function runTasksStage(
  stage: StageRecord,
  argv: string[],
  cwd: string
): Promise<void> {
  const args = parseArgs(argv);
  rejectUnknownFlags(stage.id, args, TASKS_FLAGS);

  if (args.help) {
    usage(stage, EXIT.ok);
    return;
  }

  // Step-data-driven surface (DM-003): the envelope step id, the instruction
  // base markdown, and the opt-in step_help payload all come from the stage's
  // steps.yaml. Failure paths keep computed instructions — runtime state, not
  // definitions.
  const stepDefinitions = loadStepDefinitions(stage);
  const stepVars = (changeRoot: string | null) => buildStepVars(stage.id, changeRoot, cwd);
  const markdownFor = (stepId: string, changeRoot: string | null) => {
    const step = stepDefinitions[stepId];
    return step ? renderTemplate(step.markdown || '', stepVars(changeRoot)).trim() : '';
  };
  const helpFor = (stepId: string, changeRoot: string | null) =>
    renderStepHelp(stepId, stepDefinitions[stepId], stepVars(changeRoot));
  const compose = (markdown: string, annex: string) =>
    [markdown, annex.trim()].filter(Boolean).join('\n\n');
  const helpStep = Boolean(args['help-step']);

  const base: Record<string, unknown> = {
    workflow: stage.id,
    step: 'progress',
  };

  const changeRoot = requireChangeRoot(args as ParseArgsResult, cwd, base);
  if (!changeRoot) return;

  // Detected step: complete only when implementation reaches its terminal
  // status; every working invocation is the progress step (DM-003).
  base.step = 'progress';

  try {
    // Acceptance gate (DEC-008): implementation is runnable only when the
    // required stage's tracked artifact is accepted.
    const gate = evaluateGate(stage, changeRoot, cwd);
    if (!gate.satisfied) {
      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions:
            'This stage cannot run until every required stage is accepted:\n - ' +
            gate.unsatisfied
              .map((u) => `${u.stage} (${u.artifact} status '${u.status}', required ${u.required})`)
              .join('\n - '),
          data: {
            change_root: changeRoot,
            unsatisfied_requirements: gate.unsatisfied,
          },
          errors: [makeError('STAGE_GATE_BLOCKED', { message: 'Required stage is not accepted.' })],
          warnings: [],
        },
        EXIT.actionFailed
      );
      return;
    }

    const planPath = path.join(changeRoot, stage.artifact);
    const plan = safeReadYaml(planPath) as Record<string, unknown> | null;

    if (!plan) {
      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions: `No ${stage.artifact} found in ${changeRoot}. Run the planning stage first.`,
          data: {
            change_root: changeRoot,
            plan: planPath,
          },
          errors: [
            makeError('PLAN_NOT_FOUND', {
              message: `No ${stage.artifact} found in ${changeRoot}.`,
            }),
          ],
          warnings: [],
        },
        EXIT.actionFailed
      );
      return;
    }

    if (!plan.metadata) plan.metadata = {};
    if (!Array.isArray(plan.tasks)) plan.tasks = [];

    const warnings: WarningItem[] = [];
    const errors: string[] = [];

    let updatedTaskId: string | null = null;
    let mutation = false;

    const adding = args['task-add'] !== undefined && args['task-add'] !== false;
    const removing = args['task-remove'] !== undefined && args['task-remove'] !== false;

    if (adding || removing) {
      // Task management verbs are mutually exclusive with each other and
      // with the status-update flags: one invocation performs one mutation.
      const conflicts =
        (adding && removing) ||
        (adding && (args['task-id'] || args.status)) ||
        (removing && (args['task-id'] || args.status));

      if (conflicts) {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions:
              'Use one mutation per invocation: --task-add, --task-remove, or --task-id with --status.',
            data: {
              change_root: changeRoot,
              plan: planPath,
            },
            errors: [makeError('USAGE', { message: 'Conflicting task mutation flags.' })],
            warnings: [],
          },
          EXIT.usage
        );
        return;
      }
    }

    if (adding) {
      const addResult = applyTaskAdd(
        plan,
        String(args['task-add']),
        args as Record<string, unknown>,
        {
          changeRoot,
          planPath,
        }
      );

      if ('blocked' in addResult) {
        writeJson({ ...base, ...addResult.blocked }, EXIT.usage);
        return;
      }

      updatedTaskId = addResult.taskId;
      mutation = true;
    }

    if (removing) {
      const removeResult = applyTaskRemove(plan, String(args['task-remove']), {
        changeRoot,
        planPath,
      });

      if ('blocked' in removeResult) {
        writeJson({ ...base, ...removeResult.blocked }, removeResult.exit);
        return;
      }

      updatedTaskId = removeResult.taskId;
      mutation = true;
    }

    if (args['task-id'] || args.status) {
      if (!args['task-id'] || !args.status) {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions: 'Updating a task requires both --task-id and --status.',
            data: {
              change_root: changeRoot,
              plan: planPath,
            },
            errors: [makeError('MISSING_TASK_UPDATE_FIELDS')],
            warnings: [],
          },
          EXIT.usage
        );
        return;
      }

      const taskId = String(args['task-id']);
      const status = String(args.status);

      if (!ALLOWED_TASK_STATUS.includes(status)) {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions: `Task status must be one of: ${ALLOWED_TASK_STATUS.join(', ')}.`,
            data: {
              change_root: changeRoot,
              plan: planPath,
              task_id: taskId,
              allowed_task_status: ALLOWED_TASK_STATUS,
            },
            errors: [
              makeError('INVALID_TASK_STATUS', { message: `Invalid task status: ${status}` }),
            ],
            warnings: [],
          },
          EXIT.usage
        );
        return;
      }

      const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Record<string, unknown>[];
      const task = tasks.find((t: Record<string, unknown>) => t?.id === taskId);

      if (!task) {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions: `Task ${taskId} was not found in ${stage.artifact}.`,
            data: {
              change_root: changeRoot,
              plan: planPath,
              task_id: taskId,
              known_task_ids: tasks
                .map((t: Record<string, unknown>) => t?.id as string)
                .filter(Boolean),
            },
            errors: [
              makeError('TASK_NOT_FOUND', { message: `Task ${taskId} not found in ${stage.artifact}.` }),
            ],
            warnings: [],
          },
          EXIT.actionFailed
        );
        return;
      }

      // Write-time enforcement (DEC-002): a done transition without a
      // non-empty note is rejected before any state is written.
      if (status === 'done' && !String(args.note || '').trim()) {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions:
              `Task ${taskId} cannot be marked done without a non-empty implementation note. ` +
              'Re-run with --note "..." describing what was implemented.',
            data: {
              change_root: changeRoot,
              plan: planPath,
              task_id: taskId,
            },
            errors: [
              makeError('TASK_DONE_REQUIRES_NOTE', {
                message: `Task ${taskId} cannot be marked done without a non-empty --note.`,
              }),
            ],
            warnings: [],
          },
          EXIT.usage
        );
        return;
      }

      task.status = status;

      if (args.note) {
        task.implementation_note = String(args.note);
      }

      if (status === 'in_progress' && !task.started_at) {
        task.started_at = today();
      }

      if (status === 'done') {
        task.completed_at = today();
      }

      if (!Array.isArray(task.files_changed)) {
        task.files_changed = [];
      }

      if (args.files) {
        const changed = task.files_changed as Record<string, unknown>[];
        for (const entry of parseFiles(String(args.files))) {
          const duplicate = changed.some(
            (existing) =>
              String(existing?.path) === entry.path &&
              String(existing?.operation) === entry.operation
          );
          if (!duplicate) {
            changed.push(entry);
          }
        }
      }

      const plannedPaths = new Set(
        ((Array.isArray(task.files) ? task.files : []) as unknown[])
          .map((f: unknown) =>
            typeof f === 'string'
              ? f
              : (f as Record<string, unknown>)?.path as string
          )
          .filter(Boolean)
      );

      for (const f of task.files_changed as unknown[]) {
        const p = typeof f === 'string' ? f : (f as Record<string, unknown>)?.path as string;

        if (p && plannedPaths.size > 0 && !plannedPaths.has(p)) {
          warnings.push({
            code: 'UNPLANNED_FILE',
            message: `${taskId} changed unplanned file: ${p}`,
          });
        }
      }

      updatedTaskId = taskId;
      mutation = true;
    }

    const progress = computeProgress(plan);

    const metadata = (plan.metadata as Record<string, unknown>) || {};
    const previousImplementationStatus = (metadata.implementation_status as string) || null;

    let nextImplementationStatus: string | null = previousImplementationStatus;
    if (progress.complete) {
      nextImplementationStatus = 'ready-for-review';
    } else if (
      // A mutation that touches a review-settled plan (task added or removed)
      // reopens the implementation: the ready-for-review/accepted state was
      // computed for the previous task set (FR-003 removal transition).
      mutation &&
      (previousImplementationStatus === 'ready-for-review' ||
        previousImplementationStatus === 'accepted')
    ) {
      nextImplementationStatus = 'in_progress';
    } else if (progress.in_progress > 0 || progress.done > 0) {
      nextImplementationStatus = 'in_progress';
    } else if (!previousImplementationStatus) {
      nextImplementationStatus = 'pending';
    }

    (plan.metadata as Record<string, unknown>).implementation_status = nextImplementationStatus;
    (plan.metadata as Record<string, unknown>).updated = today();

    if (mutation) {
      writeYamlAtomic(planPath, plan);
    }

    const implementationStatus = (plan.metadata as Record<string, unknown>).implementation_status as string;

    const state =
      implementationStatus === 'ready-for-review' ||
      implementationStatus === 'accepted'
        ? 'complete'
        : 'in_progress';

    if (state === 'complete') {
      base.step = 'complete';
    }

    const stepId = base.step as string;

    // Kind-split terse design (tasks kind): a task update that leaves the
    // implementation in progress renders a terse ack. The ready-for-review
    // transition (state complete), bare invocations, blocked envelopes, and
    // --help-step requests always render full.
    const terse = mutation && state === 'in_progress' && !helpStep;

    let instructions = '';

    if (state === 'complete') {
      instructions = compose(
        markdownFor('complete', changeRoot),
        'All tasks are complete or skipped. ' +
          'Run implementation review with:\n\n' +
          `sdlc implementation-review --change <change-name>`
      );
    } else if (terse && updatedTaskId) {
      const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Record<string, unknown>[];
      const found = tasks.find((t: Record<string, unknown>) => t.id === updatedTaskId);
      instructions = removing
        ? `Task ${updatedTaskId} removed.`
        : adding
          ? `Task ${updatedTaskId} added${found ? ' (pending)' : ''}.`
          : `Task ${updatedTaskId} is now ${(found?.status as string) || 'unknown'}.`;
    } else if (updatedTaskId) {
      const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Record<string, unknown>[];
      const found = tasks.find((t: Record<string, unknown>) => t.id === updatedTaskId);
      instructions = compose(
        markdownFor('progress', changeRoot),
        removing
          ? `Task ${updatedTaskId} removed.`
          : adding
            ? `Task ${updatedTaskId} added${found ? ' (pending)' : ''}.`
            : `Task ${updatedTaskId} is now ${(found?.status as string) || 'unknown'}. ` +
              'Continue implementation and update task state as work proceeds.'
      );
    } else {
      instructions = compose(
        markdownFor('progress', changeRoot),
        'Implementation progress summary.'
      );
    }

    writeJson(
      {
        ...base,
        state,
        instructions,
        data: {
          change_root: changeRoot,
          plan: planPath,
          task_id: updatedTaskId,
          implementation_status: implementationStatus,
          allowed_task_status: ALLOWED_TASK_STATUS,
          progress,
          // Opt-in step guidance (DEC-003): rendered from the stage's
          // steps.yaml, included only with --help-step.
          ...(helpStep ? { step_help: helpFor(stepId, changeRoot) } : {}),
        },
        errors,
        warnings,
        // Internal terse marker: consumed by normalizeEnvelope (never emitted)
        // to skip the delegation-directive prepend on terse acks.
        ...(terse ? { _terse: true } : {}),
      },
      EXIT.ok
    );
  } catch (err: unknown) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions: err instanceof Error ? err.message : String(err),
        data: {
          change_root: changeRoot,
        },
        errors: [
          makeError('INTERNAL_ERROR', {
            message: err instanceof Error ? err.message : String(err),
          }),
        ],
        warnings: [],
      },
      EXIT.internal
    );
  }
}
