import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { countSentences } from './shared.ts';

// sentence-count: a text field must contain between {min} and {max} sentences.
export const sentenceCount: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const field = String(params.field || '');
  const min = Number(params.min);
  const max = Number(params.max);

  if (!field || !Number.isFinite(min) || !Number.isFinite(max)) return findings;

  const value = artifact?.[field];
  if (typeof value !== 'string') return findings;

  const n = countSentences(value);
  if (n < min || n > max) {
    findings.push({
      check: 'sentence-count',
      severity: 'minor',
      category: 'completeness',
      target: field,
      finding: `${field} has ${n} sentence(s); expected ${min} to ${max}.`,
      fix: `Use ${min} to ${max} sentences`,
    });
  }

  return findings;
};
