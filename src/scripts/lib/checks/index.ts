import type { Finding } from '../types.ts';
import type { CheckContext, CheckFn } from './shared.ts';
import { uniqueIds } from './unique-ids.ts';
import { refExists } from './ref-exists.ts';
import { referencedBy } from './referenced-by.ts';
import { duplicateRefs } from './duplicate-refs.ts';
import { givenWhenThen } from './given-when-then.ts';
import { forbiddenWords } from './forbidden-words.ts';
import { sentenceCount } from './sentence-count.ts';
import { requiredNoteForStatus } from './required-note-for-status.ts';
import { allTasksTerminal } from './all-tasks-terminal.ts';
import { dependencyAcyclic } from './dependency-acyclic.ts';
import { dependencyOrder } from './dependency-order.ts';

/**
 * The capped catalog of eleven named structural checks (CMP-004, DEC-004).
 * Adding or changing a check is a design-review event; this catalog is the
 * single extension path for structural validation logic.
 */
export const CHECK_CATALOG: Record<string, { fn: CheckFn; requiredParams: string[] }> = {
  'unique-ids': { fn: uniqueIds, requiredParams: ['arrays'] },
  'ref-exists': { fn: refExists, requiredParams: ['from', 'to'] },
  'referenced-by': { fn: referencedBy, requiredParams: ['array', 'by'] },
  'duplicate-refs': { fn: duplicateRefs, requiredParams: ['array', 'list_field'] },
  'given-when-then': { fn: givenWhenThen, requiredParams: ['array'] },
  'forbidden-words': { fn: forbiddenWords, requiredParams: ['fields'] },
  'sentence-count': { fn: sentenceCount, requiredParams: ['field', 'min', 'max'] },
  'required-note-for-status': { fn: requiredNoteForStatus, requiredParams: ['array', 'statuses'] },
  'all-tasks-terminal': { fn: allTasksTerminal, requiredParams: ['array', 'allowed_statuses'] },
  'dependency-acyclic': { fn: dependencyAcyclic, requiredParams: ['array'] },
  'dependency-order': { fn: dependencyOrder, requiredParams: ['array'] },
};

export interface StructuralCheckDeclaration {
  check: string;
  params?: Record<string, unknown>;
}

export interface StructuralChecksDoc {
  version?: number;
  checks: StructuralCheckDeclaration[];
}

/**
 * Runs the named checks declared in a stage's structural-checks.yaml against an
 * artifact. An entry naming an unknown check or carrying malformed parameters
 * aborts the run with an error naming the stage folder and the check entry.
 */
export function runStageChecks(
  stageId: string,
  stageFolder: string,
  artifact: Record<string, unknown>,
  context: CheckContext,
  checksDoc: StructuralChecksDoc | null
): Finding[] {
  if (!checksDoc || !Array.isArray(checksDoc.checks)) return [];

  const findings: Finding[] = [];

  for (const entry of checksDoc.checks) {
    const name = entry?.check;
    if (typeof name !== 'string' || !CHECK_CATALOG[name]) {
      throw new Error(
        `Stage '${stageId}' (${stageFolder}) declares unknown check '${String(name)}' in structural-checks.yaml.`
      );
    }

    const params = entry?.params && typeof entry.params === 'object'
      ? (entry.params as Record<string, unknown>)
      : {};

    const spec = CHECK_CATALOG[name];
    const missing = spec.requiredParams.filter((p) => params[p] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `Stage '${stageId}' (${stageFolder}) check '${name}' is missing required parameter(s): ${missing.join(', ')}.`
      );
    }

    findings.push(...spec.fn(artifact, params, context));
  }

  return findings;
}
