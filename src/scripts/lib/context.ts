import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readYaml } from './yaml-io.ts';
import { loadDocsIndex } from './docs-index.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export function safeReadYaml(file: string): unknown {
  try {
    return readYaml(file);
  } catch {
    return null;
  }
}

export function makeCtx(cwd: string, changeRoot: string | null): { loadFile: (relPath: string) => unknown; fileExists: (relPath: string) => boolean; readFile: (relPath: string) => string | null; changedFiles: () => string[] } {
  function resolveFile(relPath: string): string | null {
    if (path.isAbsolute(relPath)) {
      return fs.existsSync(relPath) ? relPath : null;
    }

    const candidates = [];

    if (changeRoot) {
      candidates.push(path.resolve(changeRoot, relPath));
    }

    candidates.push(path.resolve(cwd, relPath));

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return null;
  }

  return {
    loadFile(relPath) {
      const abs = resolveFile(relPath);
      return abs ? safeReadYaml(abs) : null;
    },

    fileExists(relPath) {
      return Boolean(resolveFile(relPath));
    },

    readFile(relPath) {
      const abs = resolveFile(relPath);
      return abs ? fs.readFileSync(abs, 'utf8') : null;
    },

    changedFiles() {
      return [];
    },
  };
}

export function loadReviewReport(changeRoot: string | null): unknown {
  if (!changeRoot) return null;

  return safeReadYaml(path.join(changeRoot, 'review-report.yaml'));
}
