import { resolveCollections } from './artifact-paths.ts';

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function nextId(existingIds: string[] = [], prefix: string = 'ID'): string {
  const nums = (existingIds || [])
    .filter((id: string) => typeof id === 'string' && id.startsWith(`${prefix}-`))
    .map((id: string) => Number(id.slice(prefix.length + 1)))
    .filter((n: number) => Number.isInteger(n));

  const max = nums.length ? Math.max(...nums) : 0;
  const next = max + 1;

  return `${prefix}-${String(next).padStart(3, '0')}`;
}

export function nextIdsFromArrays(
  artifact: Record<string, unknown>,
  specs: Record<string, string | string[]>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [prefix, spec] of Object.entries(specs)) {
    let ids: string[];

    if (typeof spec === 'string') {
      // A string spec keeps today's top-level field behavior byte-identically.
      const arr = Array.isArray(artifact?.[spec]) ? artifact[spec] as { id?: string }[] : [];
      ids = arr.map((item: { id?: string }) => item?.id).filter((id): id is string => id !== undefined);
    } else {
      // A list spec resolves each entry as a path through the artifact path
      // resolver and unions the collected ids before nextId (DEC-004).
      const collected = new Set<string>();
      for (const entry of spec) {
        for (const collection of resolveCollections(artifact, String(entry))) {
          for (const item of collection.items) {
            const id = item?.id;
            if (typeof id === 'string') collected.add(id);
          }
        }
      }
      ids = [...collected];
    }

    result[prefix] = nextId(ids, prefix);
  }

  return result;
}

export const CHANGE_SLUG_MAX_LENGTH = 60;

// Change creation is explicit (init contract): the exact slug must already be
// a valid, unique name — the CLI never derives or suffixes one. This reports
// the first violation, or null when the name is usable as-is.
export function validateChangeSlug(name: string): string | null {
  if (/[^a-z0-9-]/.test(name)) {
    return `Change name '${name}' may only contain lowercase letters, digits, and hyphens.`;
  }
  if (!/^[a-z0-9]/.test(name)) {
    return `Change name '${name}' must start with a lowercase letter or digit.`;
  }
  if (name.length > CHANGE_SLUG_MAX_LENGTH) {
    return `Change name '${name}' is ${name.length} characters long; the maximum is ${CHANGE_SLUG_MAX_LENGTH}.`;
  }
  if (name.endsWith('-')) {
    return `Change name '${name}' must not end with a hyphen.`;
  }
  return null;
}
