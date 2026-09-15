import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Creates one throwaway directory for file-based fixture tests. */
export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
