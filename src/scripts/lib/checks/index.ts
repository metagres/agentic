import type { Finding } from '../types.ts';
import type { CheckContext, CheckFn } from './shared.ts';
import { uniqueIds } from './unique-ids.ts';
import { refExists } from './ref-exists.ts';
import { duplicateRefs } from './duplicate-refs.ts';
import { givenWhenThen } from './given-when-then.ts';
import { forbiddenWords } from './forbidden-words.ts';
import { sentenceCount } from './sentence-count.ts';
import { requiredNoteForStatus } from './required-note-for-status.ts';
import { allTasksTerminal } from './all-tasks-terminal.ts';
import { dependencyAcyclic } from './dependency-acyclic.ts';
import { dependencyOrder } from './dependency-order.ts';

/**
 * One path-bearing parameter slot of a check (CMP-003): spec is a dot-path
 * into the check's params where a 'key[]' segment iterates a list, and kind
 * says whether the addressed selectors resolve collections (arrays) or leaf
 * string values. Only [].-bearing strings inside these slots are validated
 * against the stage schema; a [].-bearing string anywhere else in a check's
 * parameters aborts as an unsupported path.
 */
export interface PathParamSpec {
  spec: string;
  kind: 'collection' | 'leaf';
}

/**
 * The capped catalog of ten named structural checks (CMP-002 part 2, AC-014;
 * referenced-by was removed with the nested acceptance-criteria format).
 * Adding or changing a check is a design-review event; this catalog is the
 * single extension path for structural validation logic.
 */
export const CHECK_CATALOG: Record<
  string,
  { fn: CheckFn; requiredParams: string[]; pathParams?: PathParamSpec[] }
> = {
  'unique-ids': {
    fn: uniqueIds,
    requiredParams: ['arrays'],
    pathParams: [
      { spec: 'arrays', kind: 'collection' },
      { spec: 'unions[].arrays', kind: 'collection' },
    ],
  },
  'ref-exists': {
    fn: refExists,
    requiredParams: ['from', 'to'],
    pathParams: [{ spec: 'to.arrays', kind: 'collection' }],
  },
  'duplicate-refs': { fn: duplicateRefs, requiredParams: ['array', 'list_field'] },
  // The arrays slot is declared ahead of the parameter rename (TASK-006) and
  // is inert until a [].-bearing string appears in that parameter.
  'given-when-then': {
    fn: givenWhenThen,
    requiredParams: ['arrays'],
    pathParams: [{ spec: 'arrays', kind: 'collection' }],
  },
  'forbidden-words': {
    fn: forbiddenWords,
    requiredParams: ['fields'],
    pathParams: [{ spec: 'fields', kind: 'leaf' }],
  },
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
