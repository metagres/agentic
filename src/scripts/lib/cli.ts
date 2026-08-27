import type { WarningItem } from './types.ts';
import { getStageById } from './stage-registry.ts';
import { delegationDirective } from './delegation.ts';

export const EXIT = {
  ok: 0,
  actionFailed: 1,
  usage: 2,
  ambiguous: 3,
  internal: 4,
};

export function parseArgs(argv: string[]): Record<string, string | boolean | string[]> {
  const args: Record<string, string | boolean | string[]> = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        const idx = arg.indexOf('=');
        const key = arg.slice(2, idx);
        const value = arg.slice(idx + 1);
        args[key] = value;
        continue;
      }

      const key = arg.slice(2);
      const next = argv[i + 1];

      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      (args._ as string[]).push(arg);
    }
  }

  return args;
}

export function normalizeEnvelope(payload: Record<string, unknown> = {}, stagesDir?: string): { workflow: string; step: string; state: string; instructions: string; data: Record<string, unknown>; errors: unknown[]; warnings: unknown[] } {
  const data: Record<string, unknown> = {
    ...(payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}),
  };

  delete data.next;
  delete data.next_action;

  if (payload._debug !== undefined) {
    data._debug = payload._debug;
  }

  const skillInstructions = payload.skill_instructions as Record<string, unknown> | undefined;

  let instructions: string =
    (payload.instructions as string) ??
    (payload.instructions_for_llm as string) ??
    (skillInstructions?.markdown as string) ??
    '';

  const errors = Array.isArray(payload.errors) ? payload.errors as { message?: string }[] : [];

  if (
    !instructions &&
    errors.length > 0 &&
    errors[0]?.message
  ) {
    instructions = errors[0].message;
  }

  const validStates = ['ok', 'in_progress', 'blocked', 'complete'];

  let state = payload.state as string;

  if (!validStates.includes(state)) {
    const candidate = (payload.status ?? payload.gate_status) as string | undefined;

    if (candidate && validStates.includes(candidate)) {
      state = candidate;
    } else if (candidate === 'pass' || candidate === 'accepted') {
      state = 'complete';
    } else if (candidate === 'fail' || candidate === 'rejected') {
      state = 'blocked';
    } else {
      state =
        errors.length > 0
          ? 'blocked'
          : 'ok';
    }
  }

  // CMP-002 (DEC-001, DEC-005): resolve the workflow id to a stage record and
  // prepend its binding-derived delegation directive ahead of the existing
  // instructions as a distinct paragraph. Cross-cutting and unknown ids
  // resolve to no stage record and stay byte-identical (FR-002); registry
  // resolution failures stay quiet so every envelope keeps emitting exactly
  // as before.
  const workflowId = (payload.workflow ?? payload.stage) as string | undefined;

  if (workflowId) {
    let directive: string | null = null;
    try {
      const stage = getStageById(process.cwd(), workflowId, stagesDir);
      if (stage?.agent) {
        directive = delegationDirective(stage);
      }
    } catch {
      directive = null;
    }

    if (directive) {
      instructions = instructions ? `${directive}\n\n${instructions}` : directive;
    }
  }

  return {
    workflow: (payload.workflow ?? payload.stage ?? 'cli') as string,
    step: (payload.step ?? 'step') as string,
    state,
    instructions: String(instructions || ''),
    data,
    errors,
    warnings: Array.isArray(payload.warnings) ? payload.warnings as WarningItem[] : [],
  };
}

export function writeJson(
  payload: Record<string, unknown>,
  code: number = EXIT.ok,
  stagesDir?: string
): void {
  const envelope = normalizeEnvelope(payload, stagesDir);

  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(code);
}
