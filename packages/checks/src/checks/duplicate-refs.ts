import type { CheckImpl, CheckManifest, Finding } from '../types.ts';
import { getTopArray } from '../shared.ts';

export const manifest: CheckManifest = {
  name: 'duplicate-refs',
  description: 'Detects duplicate entries within each item\u2019s list field, for example duplicate references inside a single entry.',
  params: [
    {
      name: 'array',
      type: 'string',
      required: true,
      description: 'Array selector of the entries to inspect (a top-level key name or a path spec).',
    },
    {
      name: 'list_field',
      type: 'string',
      required: true,
      description: 'Per-entry property that holds the list of references to scan for duplicates.',
    },
  ],
};

// duplicate-refs: detects duplicate entries within each item's list field
// (for example duplicate satisfies entries within a single component).
export const check: CheckImpl = ({ artifact, params }) => {
  const findings: Finding[] = [];
  const arrayName = String(params.array || '');
  const listField = String(params.list_field || '');

  if (!arrayName || !listField) return findings;

  for (const item of getTopArray(artifact, arrayName)) {
    const itemId = item?.id;
    const refs = Array.isArray(item?.[listField])
      ? (item[listField] as unknown[])
      : [];

    const seen = new Set<string>();
    for (const ref of refs) {
      const refStr = String(ref);
      if (refStr && seen.has(refStr)) {
        const prefix = /^([A-Z]+)-/.exec(refStr)?.[1] || 'reference';
        findings.push({
          check: 'duplicate-refs',
          category: 'traceability',
          target: `${arrayName}[].${listField}`,
          finding: `Duplicate ${prefix} reference '${refStr}' in ${String(itemId || 'entry')}`,
          fix: `Remove the duplicate ${prefix} reference`,
        });
      }
      seen.add(refStr);
    }
  }

  return findings;
};
