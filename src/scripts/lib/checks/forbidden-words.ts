import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { hasWord } from './shared.ts';
import { resolveLeafValues } from '../artifact-paths.ts';
import { FORBIDDEN_WORDS } from './words.ts';

interface FieldSpec {
  path: string;
  forbidden?: string[];
}

// forbidden-words: scan configured text fields for forbidden words.
// The word list defaults to the shared profile and may be overridden per entry.
export const forbiddenWords: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const rawFields = Array.isArray(params.fields) ? (params.fields as unknown[]) : [];

  const defaultForbidden = Array.isArray(params.forbidden)
    ? (params.forbidden as string[])
    : FORBIDDEN_WORDS;

  for (const raw of rawFields) {
    const spec = (typeof raw === 'string' ? { path: raw } : raw) as FieldSpec;
    const pathSpec = spec.path || '';

    const forbidden = Array.isArray(spec.forbidden) ? spec.forbidden : defaultForbidden;

    for (const { value, target } of resolveLeafValues(artifact, pathSpec)) {
      for (const word of forbidden) {
        if (hasWord(value, word)) {
          findings.push({
            check: 'forbidden-word',
            category: 'ambiguity',
            target,
            finding: `"${word}" is a forbidden word in ${target}.`,
            fix: 'Replace with concrete metric/condition',
          });
          break;
        }
      }
    }
  }

  return findings;
};
