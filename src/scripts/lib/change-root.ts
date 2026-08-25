import * as fs from 'node:fs';
import * as path from 'node:path';
import {
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
      fix: 'Use one of data.available_changes as --dir (the exact name or a unique part of it).',
    };
  }

  return {};
}

export function requireChangeRoot(args: ParseArgsResult, cwd: string, base: Record<string, unknown>): string | null {
  if (!args.dir) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions: 'Provide --dir <change-dir>.',
        data: {
          available_changes: listChangeDirNames(path.join(cwd, 'docs', 'changes')),
        },
        errors: [makeError('MISSING_CHANGE_DIR')],
        warnings: [],
      },
      EXIT.usage
    );
    return null;
  }

  try {
    return resolveRootOrError(String(args.dir), { cwd });
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
          instructions: err.message,
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
