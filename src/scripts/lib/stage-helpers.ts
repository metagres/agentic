import path from 'node:path';

import { safeReadYaml } from './context.ts';

export function deltaComplete(artifact: Record<string, unknown>): boolean {
  if (!Array.isArray(artifact?.delta)) return false;

  return (
    (artifact.delta as unknown[]).length > 0 ||
    (artifact?.metadata as Record<string, unknown>)?.delta_reviewed === true
  );
}

export function titleFromRequest(request: string, defaultTitle: string): string {
  const text = String(request || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (text.length <= 80) return text || defaultTitle;

  return `${text.slice(0, 77)}...`;
}

export function baseVersion(changeRoot: string | null, file: string): string | null {
  if (!changeRoot) return null;

  const artifact = safeReadYaml(path.join(changeRoot, file)) as Record<string, unknown> | null;
  return (artifact?.metadata as Record<string, unknown>)?.version as string || null;
}
