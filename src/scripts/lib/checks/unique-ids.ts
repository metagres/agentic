import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray } from './shared.ts';
import { resolveCollections } from '../artifact-paths.ts';

// unique-ids: detect duplicate ids within each configured array. Plain-name
// arrays keep today's per-array scope and finding text. Each unions group
// enforces one uniqueness scope across the union of the listed path-resolved
// collections; its duplicate finding names the duplicated id and every
// containing entry location (DM-003, AC-007).
export const uniqueIds: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const arrays = Array.isArray(params.arrays) ? (params.arrays as string[]) : [];
  const unions = Array.isArray(params.unions) ? (params.unions as unknown[]) : [];
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

  for (const rawGroup of unions) {
    const group = (rawGroup && typeof rawGroup === 'object' ? rawGroup : {}) as {
      arrays?: unknown;
    };
    const specs = Array.isArray(group.arrays) ? group.arrays.map(String) : [];

    const locationsById = new Map<string, string[]>();
    for (const spec of specs) {
      for (const collection of resolveCollections(artifact, spec)) {
        collection.items.forEach((item, index) => {
          const id = item?.[idField];
          if (typeof id !== 'string') return;
          const location = `${collection.location}[${index}]`;
          const locations = locationsById.get(id);
          if (locations) {
            locations.push(location);
          } else {
            locationsById.set(id, [location]);
          }
        });
      }
    }

    for (const [id, locations] of locationsById) {
      if (locations.length > 1) {
        findings.push({
          check: 'unique-ids',
          severity: 'blocking',
          category: 'structural',
          target: specs.join(' + '),
          finding: `Duplicate ID '${id}' at ${locations.join(', ')}`,
          fix: `Use a unique id for each entry across the unioned collections`,
        });
      }
    }
  }

  return findings;
};
