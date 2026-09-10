import * as fs from 'node:fs';
import {
  changesDirFor,
  resolveRootOrError,
  ResolveRootError,
} from './resolve-root.ts';
import { writeJson, EXIT } from './cli.ts';
import { makeError } from './error-catalog.ts';
import type { ParseArgsResult } from './types.ts';

function listChangeDirNames(changesDir: string): string[] {
  if (!fs.existsSync(changesDir)) return [];

  return fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function contextualFix(err: ResolveRootError): Record<string, string> {
  if (err.available.length > 0) {
    return {
      fix: 'Use one of data.available_changes as --change (the exact name or a unique part of it).',
    };
  }

  return {};
}

export interface ChangeRootOptions {
  /**
   * Engagement instruction (FR-012): what the caller wants done once a change
   * is engaged (e.g. 'run the review gate'). Composed after the generic
   * engagement sentence; failure paths without it keep the bare message.
   */
  instruction?: string;
}

export function requireChangeRoot(
  args: ParseArgsResult,
  cwd: string,
  base: Record<string, unknown>,
  options: ChangeRootOptions = {}
): string | null {
  const compose = (message: string) =>
    [
      'A stage invocation must be engaged with a change: provide --change <change-name> ' +
        '(one of data.available_changes). Change identification is the skill\'s job, never a stage step.',
      options.instruction?.trim(),
      message.trim(),
    ]
      .filter(Boolean)
      .join('\n\n');

  if (!args.change) {
    writeJson(
      {
        ...base,
        step: 'blocked',
        state: 'blocked',
        instructions: compose(''),
        data: {
          available_changes: listChangeDirNames(changesDirFor(cwd)),
          searched: changesDirFor(cwd),
        },
        errors: [makeError('MISSING_CHANGE_DIR')],
        warnings: [],
      },
      EXIT.usage
    );
    return null;
  }

  try {
    return resolveRootOrError(String(args.change), { cwd });
  } catch (err) {
    if (err instanceof ResolveRootError) {
      const code =
        err.candidates && err.candidates.length > 0
          ? 'AMBIGUOUS_CHANGE_DIR'
          : 'CHANGE_DIR_NOT_FOUND';

      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions: compose(err.message),
          data: {
            candidates: err.candidates || [],
            available_changes: err.available || [],
            searched: err.searched || undefined,
          },
          errors: [
            makeError(code, {
              message: err.message,
              candidates: err.candidates || [],
              ...contextualFix(err),
            }),
          ],
          warnings: [],
        },
        EXIT.ambiguous
      );
      return null;
    }
    throw err;
  }
}
