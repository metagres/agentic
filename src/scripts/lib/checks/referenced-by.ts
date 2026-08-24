import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray } from './shared.ts';

interface BySpec {
  array: string;
  ref_field: string;
}

// referenced-by: ids in {array} that are not referenced by any of the
// {by[].array}.{by[].ref_field} lists (orphan detection).
export const referencedBy: CheckFn = (artifact, params) => {
  const findings: Finding[] = [];
  const arrayName = String(params.array || '');
  const idField = String(params.id_field || 'id');
  const by = Array.isArray(params.by) ? (params.by as BySpec[]) : [];

  if (!arrayName || by.length === 0) return findings;

  const referenced = new Set<string>();
  for (const spec of by) {
    for (const item of getTopArray(artifact, spec.array)) {
      const refs = Array.isArray(item?.[spec.ref_field])
        ? (item[spec.ref_field] as unknown[])
        : [];
      for (const ref of refs) referenced.add(String(ref));
    }
  }

  const byNames = by.map((spec) => spec.array).join(', ');

  for (const item of getTopArray(artifact, arrayName)) {
    const id = item?.[idField];
    if (typeof id === 'string' && !referenced.has(id)) {
      findings.push({
        check: 'referenced-by',
        severity: 'minor',
        category: 'traceability',
        target: `${arrayName}[].${idField}`,
        finding: `${id} is not referenced by any of ${byNames}`,
        fix: `Reference '${id}' from one of ${byNames}`,
      });
    }
  }

  return findings;
};
