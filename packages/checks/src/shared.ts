import { resolveCollections } from './artifact-paths.ts';

// Whole-word, case-insensitive match for a phrase (may contain spaces).
export function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

// Resolves a single-segment spec to the top-level array it names, collapsing
// absent properties, empty arrays, and non-array shapes to []. Path specs are
// supported through the artifact path resolver; when a spec addresses multiple
// array instances, only the first is returned.
export function getTopArray(
  obj: Record<string, unknown>,
  field: string
): Record<string, unknown>[] {
  const resolved = resolveCollections(obj, field);
  return resolved.length > 0 ? resolved[0].items : [];
}
