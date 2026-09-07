import path from 'node:path';

import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray } from './shared.ts';
import { resolveCollections } from '../artifact-paths.ts';
import { safeReadYaml } from '../context.ts';

interface RefSpec {
  array: string;
  field: string;
}

// ref-covers: every id in {to.file, to.arrays, to.field} must appear at least
// once among the values of {from.array, from.field} in this artifact — the
// reverse direction of ref-exists (coverage, not dangling references). The
// from field may be scalar or a list of ids per entry.
export const refCovers: CheckFn = (artifact, params, context) => {
  const findings: Finding[] = [];
  const from = (params.from || {}) as RefSpec;
  const to = (params.to || {}) as Record<string, unknown> & {
    file?: string;
    arrays?: string[];
    field?: string;
  };

  if (!from.array || !from.field || !Array.isArray(to.arrays) || !to.field) {
    return findings;
  }

  const toFile = to.file ? String(to.file) : null;
  let targetDoc: Record<string, unknown> | null = artifact;

  if (toFile && toFile !== '.' && context.changeRoot) {
    targetDoc = safeReadYaml(path.join(context.changeRoot, toFile)) as Record<string, unknown> | null;
  }

  if (!targetDoc) return findings;

  const covered = new Set<string>();
  for (const item of getTopArray(artifact, from.array)) {
    const rawRefs = item?.[from.field];
    const refs: string[] = Array.isArray(rawRefs)
      ? rawRefs.map(String)
      : typeof rawRefs === 'string'
        ? [rawRefs]
        : [];
    for (const ref of refs) {
      if (ref) covered.add(ref);
    }
  }

  for (const arrayName of to.arrays) {
    // Plain names resolve as top-level arrays; path entries bearing [] resolve
    // through the artifact path resolver against the target document, matching
    // ref-exists. Each uncovered id yields one finding.
    const collections = arrayName.includes('[]')
      ? resolveCollections(targetDoc, arrayName)
      : [{ items: getTopArray(targetDoc, arrayName), location: arrayName }];
    for (const collection of collections) {
      for (const item of collection.items) {
        const id = item?.[to.field as string];
        if (typeof id === 'string' && !covered.has(id)) {
          findings.push({
            check: 'ref-covers',
            severity: 'blocking',
            category: 'traceability',
            target: `${toFile || 'this artifact'}:${arrayName}.${to.field}`,
            finding: `'${id}' in '${arrayName}' is not covered by any ${from.array}.${from.field} entry`,
            fix: `Add '${id}' to a '${from.array}' entry's '${from.field}'`,
          });
        }
      }
    }
  }

  return findings;
};
