import path from 'node:path';

import { safeReadYaml } from './context.mjs';

export function deltaComplete(artifact) {
  if (!Array.isArray(artifact?.delta)) return false;

  return (
    artifact.delta.length > 0 ||
    artifact?.metadata?.delta_reviewed === true
  );
}

export function titleFromRequest(request, defaultTitle) {
  const text = String(request || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (text.length <= 80) return text || defaultTitle;

  return `${text.slice(0, 77)}...`;
}

export function baseVersion(changeRoot, file) {
  if (!changeRoot) return null;

  const artifact = safeReadYaml(path.join(changeRoot, file));
  return artifact?.metadata?.version || null;
}
