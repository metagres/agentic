import { today } from './ids.ts';

export function deltaComplete(artifact: Record<string, unknown>): boolean {
  if (!Array.isArray(artifact?.delta)) return false;

  return (
    (artifact.delta as unknown[]).length > 0 ||
    (artifact?.metadata as Record<string, unknown>)?.delta_reviewed === true
  );
}

/**
 * Shared delta normalization (API-003): defaults phase from the stage's delta
 * phase and date to today for entries that omit them, so --append-delta and
 * --update-artifact produce identically shaped delta entries.
 */
export function normalizeDeltaEntries(
  entries: unknown,
  stage: { deltaPhase: string | null }
): Record<string, unknown>[] {
  if (!Array.isArray(entries)) return [];

  return entries.map((raw: unknown) => {
    const entry =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      ...entry,
      phase: entry.phase || stage.deltaPhase,
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
