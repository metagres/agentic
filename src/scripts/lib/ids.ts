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

export function nextIdsFromArrays(artifact: Record<string, unknown>, specs: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [prefix, field] of Object.entries(specs)) {
    const arr = Array.isArray(artifact?.[field]) ? artifact[field] as { id?: string }[] : [];

    result[prefix] = nextId(
      arr.map((item: { id?: string }) => item?.id).filter((id): id is string => id !== undefined),
      prefix
    );
  }

  return result;
}

export function slugify(text: string): string {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'change';
}

export function uniqueSlug(baseSlug: string, existingSlugs: string[]): string {
  if (!existingSlugs.includes(baseSlug)) return baseSlug;

  let n = 2;

  while (existingSlugs.includes(`${baseSlug}-${n}`)) {
    n += 1;
  }

  return `${baseSlug}-${n}`;
}
