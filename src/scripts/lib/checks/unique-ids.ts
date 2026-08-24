import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray } from './shared.ts';

// unique-ids: detect duplicate ids within each configured array.
export const uniqueIds: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const arrays = Array.isArray(params.arrays) ? (params.arrays as string[]) : [];
  const idField = String(params.id_field || 'id');

  for (const name of arrays) {
    const items = getTopArray(artifact, name);
    const seen = new Set<string>();
    for (const item of items) {
      const id = item?.[idField];
      if (typeof id === 'string') {
        if (seen.has(id)) {
          findings.push({
            check: 'unique-ids',
            severity: 'blocking',
            category: 'structural',
            target: `${name}[].${idField}`,
            finding: `Duplicate ID '${id}' in '${name}'`,
            fix: `Use a unique id for each entry in '${name}'`,
          });
        }
        seen.add(id);
      }
    }
  }

  return findings;
};
