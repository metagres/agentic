import type { CheckImpl, CheckManifest, Finding } from '../types.ts';
import { hasWord } from '../shared.ts';
import { resolveLeafValues } from '../artifact-paths.ts';
import { FORBIDDEN_WORDS } from './words.ts';

interface FieldSpec {
  path: string;
  forbidden?: string[];
}

export const manifest: CheckManifest = {
  name: 'forbidden-words',
  description: 'Scans the configured text fields for forbidden words and flags the first match per value.',
  params: [
    {
      name: 'fields',
      type: '(string | { path: string; forbidden?: string[] })[]',
      required: true,
      description:
        'Text fields to scan. Each entry is a path spec (top-level key or a nested path such as "sections[].text") or an object that overrides the word list for that field alone.',
    },
    {
      name: 'forbidden',
      type: 'string[]',
      required: false,
      description:
        'Replacement word list applied to every field that does not carry its own override. Defaults to the shared profile.',
    },
  ],
};

// forbidden-words: scans configured text fields for forbidden words.
// The word list defaults to the shared profile and may be overridden globally
// or per field.
export const check: CheckImpl = ({ artifact, params }) => {
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
