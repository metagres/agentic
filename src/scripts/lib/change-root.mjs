import {
  resolveRootOrError,
  ResolveRootError,
} from './resolve-root.mjs';
import { writeJson, EXIT } from './cli.mjs';

export function requireChangeRoot(args, cwd, base) {
  if (!args.dir) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions: 'Provide --dir <change-dir>.',
        data: {},
        errors: [
          {
            code: 'MISSING_CHANGE_DIR',
            message: 'A change directory is required. Use --dir <change-dir>.',
          },
        ],
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
      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions: err.message,
          data: {
            candidates: err.candidates || [],
          },
          errors: [
            {
              code:
                err.candidates && err.candidates.length > 0
                  ? 'AMBIGUOUS_CHANGE_DIR'
                  : 'CHANGE_DIR_NOT_FOUND',
              message: err.message,
              candidates: err.candidates || [],
            },
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