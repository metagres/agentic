import type { CheckImpl, CheckManifest, Finding } from '../types.ts';
import { hasWord } from '../shared.ts';
import { resolveCollections } from '../artifact-paths.ts';

export const manifest: CheckManifest = {
  name: 'given-when-then',
  description: 'Requires every entry in the addressed collection(s) to contain Given, When, and Then keywords in its statement field.',
  params: [
    {
      name: 'arrays',
      type: 'string | string[]',
      required: true,
      description:
        'One array selector or a list of them (top-level key names or path specs such as "epics[].features"). The union of the resolved collections is evaluated.',
    },
    {
      name: 'statement_field',
      type: 'string',
      required: false,
      default: 'statement',
      description: 'Per-entry property that holds the statement text to scan.',
    },
  ],
};

// given-when-then: every entry in the addressed collection(s) must contain
// Given, When, and Then keywords in its statement field. The arrays parameter
// accepts a string or a string list; a list evaluates the union of the
// path-resolved collections, with findings targeted at the full nested
// statement path.
export const check: CheckImpl = ({ artifact, params }) => {
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
