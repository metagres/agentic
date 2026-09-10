import { today } from './ids.ts';

export function deltaComplete(artifact: Record<string, unknown>): boolean {
  if (!Array.isArray(artifact?.delta)) return false;

  return (
    (artifact.delta as unknown[]).length > 0 ||
    (artifact?.metadata as Record<string, unknown>)?.delta_reviewed === true
  );
}

/**
 * Shared delta normalization (API-003, FR-011): stamps the producing stage id
 * (lowercase) and defaults date to today for entries that omit them, so
 * --append-delta and --update-artifact produce identically shaped delta
 * entries. stage replaces the retired phase field.
 */
export function normalizeDeltaEntries(
  entries: unknown,
  stage: { id: string }
): Record<string, unknown>[] {
  if (!Array.isArray(entries)) return [];

  return entries.map((raw: unknown) => {
    const entry =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      ...entry,
      stage: entry.stage || stage.id,
      date: entry.date || today(),
    };
  });
}

export function titleFromRequest(request: string, defaultTitle: string): string {
  const text = String(request || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (text.length <= 80) return text || defaultTitle;

  return `${text.slice(0, 77)}...`;
}
