import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { hasWord } from './shared.ts';
import { resolveLeafValues } from '../artifact-paths.ts';
import { BLOCKING_WORDS, ADVISORY_WORDS } from './words.ts';

interface FieldSpec {
  path: string;
  blocking?: string[];
  advisory?: string[];
}

// forbidden-words: scan configured text fields for blocking and advisory words.
// Word lists default to the shared profiles and may be overridden per entry.
export const forbiddenWords: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const rawFields = Array.isArray(params.fields) ? (params.fields as unknown[]) : [];

  const defaultBlocking = Array.isArray(params.blocking)
    ? (params.blocking as string[])
    : BLOCKING_WORDS;
  const defaultAdvisory = Array.isArray(params.advisory)
    ? (params.advisory as string[])
    : ADVISORY_WORDS;

  for (const raw of rawFields) {
    const spec = (typeof raw === 'string' ? { path: raw } : raw) as FieldSpec;
    const pathSpec = spec.path || '';

    const blocking = Array.isArray(spec.blocking) ? spec.blocking : defaultBlocking;
    const advisory = Array.isArray(spec.advisory) ? spec.advisory : defaultAdvisory;

    for (const { value, target } of resolveLeafValues(artifact, pathSpec)) {
      for (const word of blocking) {
        if (hasWord(value, word)) {
          findings.push({
            check: 'forbidden-word',
            severity: 'blocking',
            category: 'ambiguity',
            target,
            finding: `"${word}" is a blocking word in ${target}.`,
            fix: 'Replace with concrete metric/condition',
          });
          break;
        }
      }

      // Only consult advisory words when no blocking word matched this field.
      if (!findings.some((f) => f.target === target && f.severity === 'blocking')) {
        for (const word of advisory) {
          if (hasWord(value, word)) {
            findings.push({
              check: 'forbidden-word',
              severity: 'minor',
              category: 'ambiguity',
              target,
              finding: `"${word}" is an advisory word in ${target}.`,
              fix: 'Prefer must/shall and concrete conditions where possible',
            });
            break;
          }
        }
      }
    }
  }

  return findings;
};
