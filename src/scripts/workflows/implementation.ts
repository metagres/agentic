import path from 'node:path';

import { parseArgs, writeJson, EXIT } from '../lib/cli.ts';
import { writeYamlAtomic } from '../lib/yaml-io.ts';
import { safeReadYaml } from '../lib/context.ts';
import { requireChangeRoot } from '../lib/change-root.ts';
import { today } from '../lib/ids.ts';
import { loadLifecycle } from '../lib/policy-loader.ts';
import { assertTransition } from '../lib/lifecycle.ts';
import { makeError } from '../lib/error-catalog.ts';
import type { ParseArgsResult, WarningItem } from '../lib/types.ts';

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

function usage(code = EXIT.ok) {
  writeJson(
    {
      workflow: 'implementation',
      step: 'help',
      state: code === EXIT.ok ? 'ok' : 'blocked',
      instructions:
        'Usage: sdlc implementation --dir <change-dir> ' +
        '[--task-id TASK-001 --status in_progress --note "..." --files "create:src/a.ts,modify:src/b.ts"]',
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
        return {
          path: entry,
          operation: 'modify',
        };
      }

      const maybeOp = entry.slice(0, idx);
      const rest = entry.slice(idx + 1);

      if (['create', 'modify', 'delete'].includes(maybeOp)) {
        return {
          path: rest,
          operation: maybeOp,
        };
      }

      return {
        path: entry,
        operation: 'modify',
      };
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

export function runImplementation(argv: string[]) {
  const args = parseArgs(argv);

  if (args.help) {
    usage(EXIT.ok);
  }

  const cwd = args.cwd
    ? path.resolve(String(args.cwd))
    : process.cwd();

  const base: Record<string, unknown> = {
    workflow: 'implementation',
    step: args['task-id'] ? 'task_update' : 'progress',
  };

  const changeRoot = requireChangeRoot(args as ParseArgsResult, cwd, base);
  if (!changeRoot) return;

  try {
    const planPath = path.join(changeRoot, 'plan.yaml');
    const plan = safeReadYaml(planPath) as Record<string, unknown> | null;

    if (!plan) {
      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions:
            `No plan.yaml found in ${changeRoot}. Run the planning stage first.`,
          data: {
            change_root: changeRoot,
            plan: planPath,
          },
          errors: [makeError('PLAN_NOT_FOUND', { message: `No plan.yaml found in ${changeRoot}.` })],
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
            instructions:
              'Updating a task requires both --task-id and --status.',
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
            instructions:
              `Task status must be one of: ${ALLOWED_TASK_STATUS.join(', ')}.`,
            data: {
              change_root: changeRoot,
              plan: planPath,
              task_id: taskId,
              allowed_task_status: ALLOWED_TASK_STATUS,
            },
            errors: [makeError('INVALID_TASK_STATUS', { message: `Invalid task status: ${status}` })],
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
            instructions: `Task ${taskId} was not found in plan.yaml.`,
            data: {
              change_root: changeRoot,
              plan: planPath,
              task_id: taskId,
              known_task_ids: tasks.map((t: Record<string, unknown>) => t?.id as string).filter(Boolean),
            },
            errors: [makeError('TASK_NOT_FOUND', { message: `Task ${taskId} not found in plan.yaml.` })],
            warnings: [],
          },
          EXIT.actionFailed
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

      if (args.files) {
        task.files_changed = parseFiles(String(args.files));
      }

      if (!Array.isArray(task.files_changed)) {
        task.files_changed = [];
      }

      const plannedPaths = new Set(
        ((Array.isArray(task.files) ? task.files : []) as unknown[])
          .map((f: unknown) => (typeof f === 'string' ? f : (f as Record<string, unknown>)?.path as string))
          .filter(Boolean)
      );

      for (const f of (task.files_changed as unknown[])) {
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

    if (
      previousImplementationStatus &&
      nextImplementationStatus &&
      previousImplementationStatus !== nextImplementationStatus
    ) {
      try {
        assertTransition(
          loadLifecycle(cwd) as Record<string, unknown>,
          'implementation_status',
          previousImplementationStatus,
          nextImplementationStatus
        );
      } catch (err: unknown) {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions: err instanceof Error ? err.message : String(err),
            data: {
              change_root: changeRoot,
              plan: planPath,
            },
            errors: [
              makeError((err as NodeJS.ErrnoException).code || 'ILLEGAL_STATUS_TRANSITION', {
                message: err instanceof Error ? err.message : String(err),
              }),
            ],
            warnings,
          },
          EXIT.actionFailed
        );
        return;
      }
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
        'sdlc review --target implementation --dir <change-dir>';
    } else if (updatedTaskId) {
      const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Record<string, unknown>[];
      const found = tasks.find((t: Record<string, unknown>) => t.id === updatedTaskId);
      instructions =
        `Task ${updatedTaskId} is now ${found?.status as string || 'unknown'}. ` +
        'Continue implementation and update task state as work proceeds.\n\n' +
        GUARDRAILS;
    } else {
      instructions =
        'Implementation progress summary.\n\n' +
        GUARDRAILS;
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
        errors: [makeError('INTERNAL_ERROR', { message: err instanceof Error ? err.message : String(err) })],
        warnings: [],
      },
      EXIT.internal
    );
  }
}
