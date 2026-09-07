/**
 * Semantic failures file validator (failure-only review rounds, CMP-003).
 *
 * Parses the --failures YAML document: a top-level YAML list of semantic
 * failures, each exactly {check, evidence}. The check must be a declared
 * check of the reviewed (target) stage's semantic-checks.yaml — exactly what
 * semanticChecksFor(trackedStage) reads; review stages carry no
 * semantic-checks.yaml of their own. Evidence must be non-empty, duplicates
 * are refused, and there is no completeness requirement: the reviewer reports
 * only the checks that failed. A malformed entry refuses the invocation
 * naming the offending entry (FAILURE_ENTRY_INVALID / SEMANTIC_FAILURE_INVALID)
 * and nothing is written.
 *
 * Mechanical failures are never reviewer-supplied: they are CLI-computed from
 * validateArtifact output and mapped to the same uniform {check, evidence}
 * shape by the review interpreter.
 */

import { readYaml } from './yaml-io.ts';

/** Uniform failure shape: mechanical (CLI-computed) and semantic (--failures) alike. */
export interface Failure {
  check: string;
  evidence: string;
}

/** Validation failure carrying the error-catalog code for the envelope. */
export class FailureFileError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FailureFileError';
    this.code = code;
  }
}

/**
 * Parses and shape-validates the --failures YAML document: a top-level YAML
 * list of {check, evidence} semantic failures. Every entry must carry exactly
 * the two fields with non-empty string values; a status field or any other
 * extra field is refused (the former semantic-walk format is retired). An
 * empty list is refused because a rejection without a recorded failure would
 * be unactionable. Throws FailureFileError with FAILURE_ENTRY_INVALID naming
 * the offending entry; nothing is written on refusal.
 */
export function parseFailuresFile(filePath: string): Failure[] {
  const doc = readYaml(filePath) as unknown;

  if (!Array.isArray(doc)) {
    throw new FailureFileError(
      'FAILURE_ENTRY_INVALID',
      `--failures file must contain a top-level YAML list of {check, evidence} semantic failures: ${filePath}`
    );
  }

  if (doc.length === 0) {
    throw new FailureFileError(
      'FAILURE_ENTRY_INVALID',
      '--failures file carries no entries: a rejection must name at least one failed semantic check.'
    );
  }

  return doc.map((raw: unknown, idx: number): Failure => {
    const entry =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;

    if (!entry) {
      throw new FailureFileError(
        'FAILURE_ENTRY_INVALID',
        `--failures entry ${idx} must be a {check, evidence} object.`
      );
    }

    const extra = Object.keys(entry).filter((k) => k !== 'check' && k !== 'evidence');
    if (extra.length > 0) {
      throw new FailureFileError(
        'FAILURE_ENTRY_INVALID',
        `--failures entry ${idx} carries unsupported field(s): ${extra.join(', ')}. Only {check, evidence} is accepted — the former semantic walk ({check_id, status, evidence}) is retired.`
      );
    }

    const check = typeof entry.check === 'string' ? entry.check.trim() : '';
    const evidence = typeof entry.evidence === 'string' ? entry.evidence.trim() : '';

    if (!check || !evidence) {
      throw new FailureFileError(
        'FAILURE_ENTRY_INVALID',
        `--failures entry ${idx} is missing its required check or evidence field.`
      );
    }

    return { check, evidence };
  });
}

/**
 * Validates parsed semantic failures against the reviewed (target) stage's
 * semantic-checks.yaml check list: every check must be declared there and no
 * check may appear twice. There is no completeness requirement — a reviewer
 * reports only the checks that failed. Throws FailureFileError with
 * SEMANTIC_FAILURE_INVALID; nothing is written on refusal.
 */
export function validateSemanticFailures(
  failures: Failure[],
  stageChecks: string[]
): void {
  const seen = new Set<string>();

  for (const failure of failures) {
    if (!stageChecks.includes(failure.check)) {
      throw new FailureFileError(
        'SEMANTIC_FAILURE_INVALID',
        `--failures entry names a check that is not declared in the target stage's semantic-checks.yaml: "${failure.check.slice(0, 80)}".`
      );
    }

    if (seen.has(failure.check)) {
      throw new FailureFileError(
        'SEMANTIC_FAILURE_INVALID',
        `--failures file carries a duplicate entry for check "${failure.check.slice(0, 80)}".`
      );
    }

    seen.add(failure.check);
  }
}
