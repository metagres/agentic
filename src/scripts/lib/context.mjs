import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readYaml } from './yaml-io.mjs';
import { loadDocsIndex } from './docs-index.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export function safeReadYaml(file) {
  try {
    return readYaml(file);
  } catch {
    return null;
  }
}

export function loadContract(contractFile, cwd, warnings = []) {
  const candidates = [
    // Bundled runtime:
    //   <agent-root>/sdlc/scripts/sdlc.mjs
    //   <agent-root>/sdlc/contracts/<contractFile>
    path.resolve(scriptDir, '..', 'contracts', contractFile),

    // Development runtime:
    //   src/scripts/lib/context.mjs
    //   src/contracts/<contractFile>
    path.resolve(scriptDir, '..', '..', 'contracts', contractFile),

    // Extra fallbacks.
    path.resolve(scriptDir, '..', '..', '..', 'contracts', contractFile),
    path.join(cwd, 'contracts', contractFile),
    path.join(cwd, 'src', 'contracts', contractFile),
  ];

  for (const candidate of candidates) {
    const contract = safeReadYaml(candidate);

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

export function makeCtx(cwd, changeRoot) {
  function resolveFile(relPath) {
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

export function semanticSummary(artifact, contract) {
  const checks = contract?.semantic_checks || [];

  const results = Array.isArray(artifact?.semantic_validation)
    ? artifact.semantic_validation
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

  const missing = [];
  const failed = new Set();

  for (const check of checks) {
    const result = byCheckId.get(check.id);

    if (!result) {
      missing.push(check.id);
      continue;
    }

    const evidence = String(result.evidence || '').trim();

    if (evidence.length < 20) {
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
    failed: [...failed],
    results,
  };
}

export function loadReviewReport(changeRoot) {
  if (!changeRoot) return null;

  return safeReadYaml(path.join(changeRoot, 'review-report.yaml'));
}
