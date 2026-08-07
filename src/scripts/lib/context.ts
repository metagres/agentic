import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readYaml } from './yaml-io.ts';
import { loadDocsIndex } from './docs-index.ts';
import type { WarningItem } from './types.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export function safeReadYaml(file: string): unknown {
  try {
    return readYaml(file);
  } catch {
    return null;
  }
}

export function loadContract(contractFile: string, cwd: string, warnings: WarningItem[] = []): Record<string, unknown> {
  const candidates = [
    // Bundled runtime:
    //   <agent-root>/sdlc/scripts/sdlc.js
    //   <agent-root>/sdlc/contracts/<contractFile>
    path.resolve(scriptDir, '..', 'contracts', contractFile),

    // Development runtime:
    //   src/scripts/lib/context.ts
    //   src/contracts/<contractFile>
    path.resolve(scriptDir, '..', '..', 'contracts', contractFile),

    // Extra fallbacks.
    path.resolve(scriptDir, '..', '..', '..', 'contracts', contractFile),
    path.join(cwd, 'contracts', contractFile),
    path.join(cwd, 'src', 'contracts', contractFile),
  ];

  for (const candidate of candidates) {
    const contract = safeReadYaml(candidate) as Record<string, unknown> | null;

    if (contract) return contract;
  }

  warnings.push({
    code: 'CONTRACT_MISSING',
    message:
      `No contract found: ${contractFile}. ` +
      `Looked in: ${candidates.join(', ')}`,
  });

  return {
    checks: [],
    semantic_checks: [],
  };
}

export function requireContract(contractFile: string, cwd: string, warnings: WarningItem[] = []): Record<string, unknown> {
  const contract = loadContract(contractFile, cwd, warnings);
  if (!contract || !Array.isArray(contract.checks) || (contract.checks as unknown[]).length === 0) {
    const err = new Error(`Required contract not found or empty: ${contractFile}`) as NodeJS.ErrnoException;
    err.code = 'CONTRACT_MISSING';
    throw err;
  }
  return contract;
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
