import type { Finding } from '../types.ts';

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

export function getTopArray(
  obj: Record<string, unknown>,
  field: string
): Record<string, unknown>[] {
  return Array.isArray(obj?.[field]) ? (obj[field] as Record<string, unknown>[]) : [];
}

export function resolvePath(
  artifact: Record<string, unknown>,
  pathSpec: string
): { value: string; target: string }[] {
  const out: { value: string; target: string }[] = [];

  if (pathSpec.includes('[].')) {
    const [arrayField, itemField] = pathSpec.split('[].');
    const items = getTopArray(artifact, arrayField);
    items.forEach((item, i) => {
      if (typeof item?.[itemField] === 'string') {
        out.push({
          value: item[itemField] as string,
          target: `${arrayField}[${i}].${itemField}`,
        });
      }
    });
    return out;
  }

  if (typeof artifact?.[pathSpec] === 'string') {
    out.push({ value: artifact[pathSpec] as string, target: pathSpec });
  }

  return out;
}
