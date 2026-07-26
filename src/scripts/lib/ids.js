export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso() {
  return new Date().toISOString();
}

export function nextId(existingIds = [], prefix = 'ID') {
  const nums = (existingIds || [])
    .filter((id) => typeof id === 'string' && id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter((n) => Number.isInteger(n));

  const max = nums.length ? Math.max(...nums) : 0;
  const next = max + 1;

  return `${prefix}-${String(next).padStart(3, '0')}`;
}

export function nextIdsFromArrays(artifact, specs) {
  const result = {};

  for (const [prefix, field] of Object.entries(specs)) {
    const arr = Array.isArray(artifact?.[field]) ? artifact[field] : [];

    result[prefix] = nextId(
      arr.map((item) => item?.id),
      prefix
    );
  }

  return result;
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'change';
}

export function uniqueSlug(baseSlug, existingSlugs) {
  if (!existingSlugs.includes(baseSlug)) return baseSlug;

  let n = 2;

  while (existingSlugs.includes(`${baseSlug}-${n}`)) {
    n += 1;
  }

  return `${baseSlug}-${n}`;
}
