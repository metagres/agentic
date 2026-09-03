import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { hasWord } from './shared.ts';
import { resolveCollections } from '../artifact-paths.ts';

// given-when-then: every entry in the addressed collection(s) must contain
// Given, When, and Then keywords in its {statement_field}. The arrays
// parameter accepts a string or a string list; a list evaluates the union of
// the path-resolved collections, with findings targeted at the full nested
// statement path (CMP-002 part 2, DEC-002).
export const givenWhenThen: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const statementField = String(params.statement_field || 'statement');

  const specs = Array.isArray(params.arrays)
    ? (params.arrays as unknown[]).map(String)
    : params.arrays !== undefined
      ? [String(params.arrays)]
      : [];

  for (const spec of specs) {
    if (!spec) continue;

    for (const collection of resolveCollections(artifact, spec)) {
      collection.items.forEach((item, i) => {
        const statement = String(item?.[statementField] || '');
        const target = `${collection.location}[${i}].${statementField}`;
        const missing = ['given', 'when', 'then'].filter(
          (kw) => !hasWord(statement, kw)
        );

        if (missing.length > 0) {
          findings.push({
            check: 'given-when-then',
            severity: 'blocking',
            category: 'ambiguity',
            target,
            finding: `${target} is missing keyword(s): ${missing.join(', ')}.`,
            fix: 'Restructure as Given <state>, When <action>, Then <result>',
          });
        }
      });
    }
  }

  return findings;
};
