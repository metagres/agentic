import type { CheckImpl, CheckManifest, Finding } from '../types.ts';
import { getTopArray } from '../shared.ts';

export const manifest: CheckManifest = {
  name: 'required-note-for-status',
  description: 'Requires entries whose status is one of the configured statuses to carry a non-empty note.',
  params: [
    {
      name: 'array',
      type: 'string',
      required: true,
      description: 'Array selector of the entries to inspect (a top-level key name or a path spec).',
    },
    {
      name: 'statuses',
      type: 'string[]',
      required: true,
      description: 'Statuses that require a note, for example terminal or blocked statuses.',
    },
    {
      name: 'note_field',
      type: 'string',
      required: false,
      default: 'implementation_note',
      description: 'Per-entry property that must hold a non-empty note.',
    },
  ],
};

// required-note-for-status: entries with a terminal/blocked status must carry
// a non-empty note (implementation_note for tasks).
export const check: CheckImpl = ({ artifact, params }) => {
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
        category: 'completeness',
        target: `${arrayName}[].${noteField}`,
        finding: `Task ${String(item?.id || 'entry')} has status '${status}' but no ${noteField}`,
        fix: `Add a ${noteField} explaining what was done and how it was verified`,
      });
    }
  }

  return findings;
};
