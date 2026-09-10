import type { WarningItem } from './types.ts';
import * as path from 'node:path';

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

// The single args-to-root derivation: the effective project root is the
// --cwd override (resolved against process.cwd() when relative) or the
// invocation working directory itself.
export function resolveCwd(args: Record<string, string | boolean | string[]>): string {
  return args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
}

// Shared help text for the --cwd override flag (CMP-005): one constant keeps
// the wording identical across every help and usage surface.
export const CWD_FLAG_DOC =
  '--cwd <project-root>: run as if invoked from the given project root (default: the current working directory).';

export function normalizeEnvelope(payload: Record<string, unknown> = {}): { command: string; step: string; state: string; instructions: string; data: Record<string, unknown>; errors: unknown[]; warnings: unknown[] } {
  const data: Record<string, unknown> = {
    ...(payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}),
  };

  if (payload._debug !== undefined) {
    data._debug = payload._debug;
  }

  let instructions = (payload.instructions as string) ?? '';

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

  return {
    command: (payload.command ?? 'cli') as string,
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
  code: number = EXIT.ok
): void {
  const envelope = normalizeEnvelope(payload);

  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(code);
}
