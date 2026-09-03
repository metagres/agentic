import type { Finding } from '../types.ts';
import { resolveCollections, resolveLeafValues } from '../artifact-paths.ts';

export interface CheckContext {
  cwd: string;
  changeRoot: string | null;
}

export type CheckFn = (
  artifact: Record<string, unknown>,
  params: Record<string, unknown>,
  context: CheckContext
) => Finding[];

// Whole-word, case-insensitive match for a phrase (may contain spaces).
export function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

// Count sentences by splitting on [.!?]+ and counting non-empty segments.
export function countSentences(text: string): number {
  if (!text) return 0;
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

// Delegates to the artifact path resolver (DEC-001): single-segment specs
// collapse to the resolver's top-level array resolution with identical items.
export function getTopArray(
  obj: Record<string, unknown>,
  field: string
): Record<string, unknown>[] {
  const resolved = resolveCollections(obj, field);
  return resolved.length > 0 ? resolved[0].items : [];
}

// Delegates to the artifact path resolver (DEC-001): single-segment and
// two-segment specs produce byte-identical values and targets; specs with
// more segments resolve through the full segment([].segment)* grammar.
export function resolvePath(
  artifact: Record<string, unknown>,
  pathSpec: string
): { value: string; target: string }[] {
  return resolveLeafValues(artifact, pathSpec);
}
