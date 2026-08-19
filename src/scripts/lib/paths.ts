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
