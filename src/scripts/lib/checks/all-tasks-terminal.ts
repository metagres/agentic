import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray } from './shared.ts';

// all-tasks-terminal: every entry in {array} must have one of the allowed
// terminal statuses.
export const allTasksTerminal: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const arrayName = String(params.array || '');
  const allowed = Array.isArray(params.allowed_statuses)
    ? (params.allowed_statuses as string[])
    : [];

  if (!arrayName || allowed.length === 0) return findings;

  const tasks = getTopArray(artifact, arrayName);
  if (tasks.length === 0) return findings;

  const doneCount = tasks.filter((t) => allowed.includes(String(t?.status))).length;

  if (doneCount < tasks.length) {
    findings.push({
      check: 'all-tasks-terminal',
      severity: 'blocking',
      category: 'completeness',
      target: arrayName,
      finding: `Not all tasks are complete (${doneCount} of ${tasks.length} ${allowed.join('/')})`,
      fix: 'Complete or skip every task before finalizing',
    });
  }

  return findings;
};
