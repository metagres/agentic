import type { CheckImpl, CheckManifest, Finding } from '../types.ts';
import { getTopArray } from '../shared.ts';

export const manifest: CheckManifest = {
  name: 'all-tasks-terminal',
  description: 'Requires every entry in the configured array to have one of the allowed terminal statuses.',
  params: [
    {
      name: 'array',
      type: 'string',
      required: true,
      description: 'Array selector of the entries that must all be terminal (a top-level key name or a path spec).',
    },
    {
      name: 'allowed_statuses',
      type: 'string[]',
      required: true,
      description: 'Terminal statuses, for example ["done", "skipped"].',
    },
  ],
};

// all-tasks-terminal: every entry in {array} must have one of the allowed
// terminal statuses.
export const check: CheckImpl = ({ artifact, params }) => {
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
      category: 'completeness',
      target: arrayName,
      finding: `Not all tasks are complete (${doneCount} of ${tasks.length} ${allowed.join('/')})`,
      fix: 'Complete or skip every task before finalizing',
    });
  }

  return findings;
};
