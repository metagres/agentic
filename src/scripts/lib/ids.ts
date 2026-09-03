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

// Change-directory slugs (TASK-009): lowercase, punctuation collapsed to
// single hyphens, and trimmed to the 60-char budget by dropping whole words —
// never mid-word, never a trailing hyphen. A single word longer than the
// budget cannot be kept whole; it is hard-truncated as the only way to stay
// within budget.
export function slugify(text: string): string {
  const base = String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!base) return 'change';
  if (base.length <= 60) return base;

  let kept = '';
  for (const word of base.split('-')) {
    const candidate = kept ? `${kept}-${word}` : word;
    if (candidate.length > 60) break;
    kept = candidate;
  }

  return kept || base.slice(0, 60);
}

export const CHANGE_SLUG_MAX_LENGTH = 60;

// Explicit change names (TASK-001): when --change and --request are both given
// and no change directory matches, the change is created under the exact
// provided name. That name must already be a valid slug; this reports the
// first violation, or null when the name is usable as-is.
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

export function uniqueSlug(baseSlug: string, existingSlugs: string[]): string {
  if (!existingSlugs.includes(baseSlug)) return baseSlug;

  let n = 2;

  while (existingSlugs.includes(`${baseSlug}-${n}`)) {
    n += 1;
  }

  return `${baseSlug}-${n}`;
}
