import path from 'node:path';

import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray } from './shared.ts';
import { safeReadYaml } from '../context.ts';

interface RefSpec {
  array: string;
  field: string;
}

// ref-exists: references from {from.array, from.field} of this artifact must
// exist among the ids of {to.file, to.arrays, to.field} in a target artifact.
export const refExists: CheckFn = (artifact, params, context) => {
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

  const validIds = new Set<string>();
  for (const arrayName of to.arrays) {
    for (const item of getTopArray(targetDoc, arrayName)) {
      const id = item?.[to.field as string];
      if (typeof id === 'string') validIds.add(id);
    }
  }

  const items = getTopArray(artifact, from.array);
  for (const item of items) {
    const itemId = item?.id ? String(item.id) : null;
    const rawRefs = item?.[from.field];
    const refs: string[] = Array.isArray(rawRefs)
      ? rawRefs.map(String)
      : typeof rawRefs === 'string'
        ? [rawRefs]
        : [];

    for (const refStr of refs) {
      if (refStr && !validIds.has(refStr)) {
        findings.push({
          check: 'ref-exists',
          severity: 'blocking',
          category: 'traceability',
          target: `${from.array}[].${from.field}`,
          finding: `${itemId || 'an entry'} references missing ${from.field} value '${refStr}' in ${toFile || 'this artifact'}`,
          fix: `Add the missing ${from.field} entry or fix the reference`,
        });
      }
    }
  }

  return findings;
};
