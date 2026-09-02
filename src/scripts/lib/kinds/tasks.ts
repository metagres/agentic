import path from 'node:path';

import type { StageRecord } from '../stage-registry.ts';
import { parseArgs, writeJson, EXIT, CWD_FLAG_DOC } from '../cli.ts';
import { writeYamlAtomic } from '../yaml-io.ts';
import { safeReadYaml } from '../context.ts';
import { requireChangeRoot } from '../change-root.ts';
import { today } from '../ids.ts';
import { makeError } from '../error-catalog.ts';
import { evaluateGate } from '../requires-graph.ts';
import type { ParseArgsResult, WarningItem } from '../types.ts';

const ALLOWED_TASK_STATUS = [
  'pending',
  'in_progress',
  'done',
  'blocked',
  'skipped',
];

const GUARDRAILS = `
## Planning quality guardrails

Before and during implementation:

- A task should be one coherent unit of work, not a whole feature and not pseudocode.
- Do not mix refactoring and new behavior in the same task if avoidable.
- For refactoring, ensure behavior-preserving tests exist before changing code.
- If implementation requires unplanned architectural or behavioral changes, stop and update the plan.
- Incidental changes such as imports, formatting, or test helpers are acceptable with a clear note.
- Every done, blocked, or skipped task must have an implementation note.
`.trim();

function usage(stage: StageRecord, code = EXIT.ok) {
  writeJson(
    {
      workflow: stage.id,
      step: 'help',
      state: code === EXIT.ok ? 'ok' : 'blocked',
      instructions:
        `Usage: sdlc ${stage.id} --change <change-name> ` +
        '[--task-id TASK-001 --status in_progress --note "..." --files "create:src/a.ts,modify:src/b.ts"] ' +
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

export async function runTasksStage(
  stage: StageRecord,
  argv: string[],
  cwd: string
): Promise<void> {
  const args = parseArgs(argv);

  if (args.help) {
    usage(stage, EXIT.ok);
    return;
  }

  const base: Record<string, unknown> = {
    workflow: stage.id,
    step: args['task-id'] ? 'task_update' : 'progress',
  };

  const changeRoot = requireChangeRoot(args as ParseArgsResult, cwd, base);
  if (!changeRoot) return;

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
    } else if (progress.in_progress > 0 || progress.done > 0) {
      nextImplementationStatus = 'in_progress';
    } else if (mutation && previousImplementationStatus === 'accepted') {
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

    let instructions = GUARDRAILS;

    if (state === 'complete') {
      instructions =
        'All tasks are complete or skipped. ' +
        'Run implementation review with:\n\n' +
        `sdlc implementation-review --change <change-name>`;
    } else if (updatedTaskId) {
      const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Record<string, unknown>[];
      const found = tasks.find((t: Record<string, unknown>) => t.id === updatedTaskId);
      instructions =
        `Task ${updatedTaskId} is now ${(found?.status as string) || 'unknown'}. ` +
        'Continue implementation and update task state as work proceeds.\n\n' +
        GUARDRAILS;
    } else {
      instructions = 'Implementation progress summary.\n\n' + GUARDRAILS;
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
        },
        errors,
        warnings,
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
