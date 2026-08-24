import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray, hasWord } from './shared.ts';

// given-when-then: every entry in {array} must contain Given, When, and Then
// keywords in its {statement_field}.
export const givenWhenThen: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const arrayName = String(params.array || '');
  const statementField = String(params.statement_field || 'statement');

  if (!arrayName) return findings;

  getTopArray(artifact, arrayName).forEach((item, i) => {
    const statement = String(item?.[statementField] || '');
    const target = `${arrayName}[${i}].${statementField}`;
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

  return findings;
};
