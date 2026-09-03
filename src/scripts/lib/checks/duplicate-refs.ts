import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray } from './shared.ts';

// duplicate-refs: detect duplicate entries within each item's list field
// (for example duplicate component_ids within a single traceability entry).
export const duplicateRefs: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const arrayName = String(params.array || '');
  const listField = String(params.list_field || '');

  if (!arrayName || !listField) return findings;

  for (const item of getTopArray(artifact, arrayName)) {
    const itemId = item?.id;
    const refs = Array.isArray(item?.[listField])
      ? (item[listField] as unknown[])
      : [];

    const seen = new Set<string>();
    for (const ref of refs) {
      const refStr = String(ref);
      if (refStr && seen.has(refStr)) {
        const prefix = /^([A-Z]+)-/.exec(refStr)?.[1] || 'reference';
        findings.push({
          check: 'duplicate-refs',
          severity: 'minor',
          category: 'traceability',
          target: `${arrayName}[].${listField}`,
          finding: `Duplicate ${prefix} reference '${refStr}' in ${String(itemId || 'entry')}`,
          fix: `Remove the duplicate ${prefix} reference`,
        });
      }
      seen.add(refStr);
    }
  }

  return findings;
};
