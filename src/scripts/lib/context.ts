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

export function semanticSummary(artifact: Record<string, unknown>, contract: Record<string, unknown>, options: Record<string, unknown> = {}): { complete: boolean; missing: string[]; failed: string[]; results: unknown[] } {
  const checks = (contract?.semantic_checks || []) as { id: string; severity: string; category: string; description: string }[];

  const results = Array.isArray(artifact?.semantic_validation)
    ? artifact.semantic_validation as { check_id: string; status: string; evidence: string; evaluated_at: string }[]
    : [];

  if (checks.length === 0) {
    return {
      complete: true,
      missing: [],
      failed: [],
      results,
    };
  }

  const byCheckId = new Map(results.map((r) => [r.check_id, r]));

  const missing: string[] = [];
  const failed = new Set<string>();

  for (const check of checks) {
    const result = byCheckId.get(check.id);

    if (!result) {
      missing.push(check.id);
      continue;
    }

    const evidence = String(result.evidence || '').trim();

    const minEvidenceChars = Number(options.minEvidenceChars || 20);
      if (evidence.length < minEvidenceChars) {
      failed.add(check.id);
    }

    if (!['pass', 'fail', 'waived'].includes(result.status)) {
      failed.add(check.id);
    }

    if (check.severity === 'blocking' && result.status !== 'pass') {
      failed.add(check.id);
    }
  }

  return {
    complete: missing.length === 0 && failed.size === 0,
    missing,
    failed: [...failed] as string[],
    results,
  };
}

export function loadReviewReport(changeRoot: string | null): unknown {
  if (!changeRoot) return null;

  return safeReadYaml(path.join(changeRoot, 'review-report.yaml'));
}
