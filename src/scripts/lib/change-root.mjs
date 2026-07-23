import {
  resolveRootOrError,
  ResolveRootError,
} from './resolve-root.mjs';
import { writeJson, EXIT } from './cli.mjs';
import { makeError } from './error-catalog.mjs';

export function requireChangeRoot(args, cwd, base) {
  if (!args.dir) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions: 'Provide --dir <change-dir>.',
        data: {},
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
          },
          errors: [
            makeError(code, {
              message: err.message,
              candidates: err.candidates || [],
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
