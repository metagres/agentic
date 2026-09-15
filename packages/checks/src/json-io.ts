import fs from 'node:fs';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads and parses one JSON file. Throws a descriptive error when the file
 * cannot be read or is not valid JSON.
 */
export function readJson(file: string): unknown {
  let raw: string;

  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err: unknown) {
    throw new Error(`Unable to read file ${file}: ${errorMessage(err)}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Invalid JSON in ${file}: ${errorMessage(err)}`);
  }
}

/**
 * Reads and parses one JSON file, returning null when the file is missing,
 * unreadable, or not valid JSON. Cross-document checks use this for optional
 * target files so that an absent file no-ops instead of failing the run.
 */
export function tryReadJson(file: string): unknown | null {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

/**
 * Parses one JSON string. Throws a descriptive error naming the origin, for
 * example an inline CLI flag or stdin.
 */
export function parseJson(text: string, label: string = 'input'): unknown {
  try {
    return JSON.parse(text);
  } catch (err: unknown) {
    throw new Error(`Invalid JSON from ${label}: ${errorMessage(err)}`);
  }
}
