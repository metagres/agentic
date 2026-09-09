// Invocation-class classification for the improvement-review envelope
// measurement (WB): the detection-vs-mutation matrix of the nine pipeline
// stages, extracted as a pure module so unit tests classify without
// spawning the CLI. Dev-only helper source for the improvement-review
// skill; never deployed. Plain ESM TypeScript (DEC-004), node builtins
// only, no side effects at import time.
//
// Classification carries the CMP-004 / RISK-001 mitigation: review stages
// hardcode mandatory --dry-run, so their invocations open or refresh an
// inspection round without mutating artifacts (detection); non-dry-run
// stages create or mutate artifacts (mutation). The per-class split keeps
// the companion plan's before/after envelope delta measurable per
// invocation class rather than blended into one total.

/** The two invocation classes a stage invocation can belong to. */
export type InvocationClass = 'detection' | 'mutation';

/**
 * The nine pipeline stage ids in canonical order with the invocation-class
 * mutation matrix (CMP-004, RISK-001 mitigation): review stages hardcode
 * mandatory --dry-run.
 */
export const STAGES: { id: string; dryRun: boolean }[] = [
  { id: 'requirements', dryRun: false },
  { id: 'requirements-review', dryRun: true },
  { id: 'design', dryRun: false },
  { id: 'design-review', dryRun: true },
  { id: 'planning', dryRun: false },
  { id: 'planning-review', dryRun: true },
  { id: 'implementation', dryRun: false },
  { id: 'implementation-review', dryRun: true },
  { id: 'knowledge-extraction', dryRun: false },
];

/**
 * Pure classification of a stage invocation: review stages (--dry-run
 * mandatory) are detection; all other stages are mutation. Throws naming
 * the unknown id — never exits — so the function stays pure.
 */
export function invocationClass(stageId: string): InvocationClass {
  const stage = STAGES.find((entry) => entry.id === stageId);
  if (!stage) {
    throw new Error(`unknown stage id '${stageId}'`);
  }
  return stage.dryRun ? 'detection' : 'mutation';
}
