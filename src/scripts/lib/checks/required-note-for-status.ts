import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray } from './shared.ts';

// required-note-for-status: entries with a terminal/blocked status must carry a
// non-empty note (implementation_note for tasks).
export const requiredNoteForStatus: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const arrayName = String(params.array || '');
  const statuses = Array.isArray(params.statuses) ? (params.statuses as string[]) : [];
  const noteField = String(params.note_field || 'implementation_note');

  if (!arrayName || statuses.length === 0) return findings;

  for (const item of getTopArray(artifact, arrayName)) {
    const status = item?.status;
    if (typeof status !== 'string' || !statuses.includes(status)) continue;

    const note = item?.[noteField];
    if (!note || String(note).trim().length === 0) {
      findings.push({
        check: 'required-note-for-status',
        severity: 'blocking',
        category: 'completeness',
        target: `${arrayName}[].${noteField}`,
        finding: `Task ${String(item?.id || 'entry')} has status '${status}' but no ${noteField}`,
        fix: `Add a ${noteField} explaining what was done and how it was verified`,
      });
    }
  }

  return findings;
};
