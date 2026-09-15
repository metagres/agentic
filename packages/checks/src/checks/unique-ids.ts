import type { CheckImpl, CheckManifest, Finding } from '../types.ts';
import { getTopArray } from '../shared.ts';
import { resolveCollections } from '../artifact-paths.ts';

export const manifest: CheckManifest = {
  name: 'unique-ids',
  description: 'Detects duplicate ids within each configured array and across declared union scopes.',
  params: [
    {
      name: 'arrays',
      type: 'string[]',
      required: true,
      description:
        'Array selectors whose entries must carry unique ids. Each selector is a top-level key name or a path spec such as "epics[].features"; every addressed collection is validated in its own scope.',
    },
    {
      name: 'unions',
      type: '{ arrays: string[] }[]',
      required: false,
      default: [],
      description:
        'Groups that enforce one uniqueness scope across the union of the listed collections. A duplicate is reported once per group with every containing entry location.',
    },
    {
      name: 'id_field',
      type: 'string',
      required: false,
      default: 'id',
      description: 'Entry property that holds the identifier.',
    },
  ],
};

// unique-ids: detects duplicate ids within each configured array. Plain-name
// arrays keep a per-array scope. Each unions group enforces one uniqueness
// scope across the union of the listed path-resolved collections; its
// duplicate finding names the duplicated id and every containing location.
export const check: CheckImpl = ({ artifact, params }) => {
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
          category: 'structural',
          target: specs.join(' + '),
          finding: `Duplicate ID '${id}' at ${locations.join(', ')}`,
          fix: 'Use a unique id for each entry across the unioned collections',
        });
      }
    }
  }

  return findings;
};
