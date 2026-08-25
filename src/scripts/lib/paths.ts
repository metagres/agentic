import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export function resolveRuntimeFile(dirName: string, fileName: string, cwd: string): string | null {
  const candidates = [
    path.resolve(scriptDir, '..', dirName, fileName),
    path.resolve(scriptDir, '..', '..', dirName, fileName),
    path.resolve(scriptDir, '..', '..', '..', dirName, fileName),
    path.join(cwd, dirName, fileName),
    path.join(cwd, 'src', dirName, fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveRuntimeDir(dirName: string, cwd: string): string | null {
  const candidates = [
    path.resolve(scriptDir, '..', dirName),
    path.resolve(scriptDir, '..', '..', dirName),
    path.resolve(scriptDir, '..', '..', '..', dirName),
    path.resolve(cwd, 'src', dirName),
    path.resolve(cwd, dirName),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// Resolves the stages directory the same way templates, schemas, and policies are
// resolved today. In the repository this is src/stages/; in the deployed bundle it
// is the stages/ folder copied next to the CLI script.
export function resolveStagesDir(cwd: string = process.cwd()): string | null {
  return resolveRuntimeDir('stages', cwd);
}

// Resolves the agents directory the same way stages, templates, schemas, and
// policies are resolved today. In the repository this is src/agents/; in the
// deployed bundle it is the agents/ folder copied next to the CLI script.
export function resolveAgentsDir(cwd: string = process.cwd()): string | null {
  return resolveRuntimeDir('agents', cwd);
}
