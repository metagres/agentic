import path from 'node:path';

import type { CheckImpl, CheckManifest, Finding } from '../types.ts';
import { getTopArray } from '../shared.ts';
import { resolveCollections } from '../artifact-paths.ts';
import { tryReadJson } from '../json-io.ts';

interface RefSpec {
  array: string;
  field: string;
}

interface ToSpec {
  file?: string;
  arrays?: string[];
  field?: string;
}

export const manifest: CheckManifest = {
  name: 'ref-covers',
  description:
    'Validates the reverse direction of ref-exists: every id in the target document must appear at least once among the reference values of this artifact (coverage, not dangling references). The target document is resolved as: params.to.file of "." meaning this artifact, then the inline artifacts.target document, then the file params.to.file read relative to basePath.',
  params: [
    {
      name: 'from',
      type: '{ array: string; field: string }',
      required: true,
      description:
        'Where the covering references live in this artifact: the array of referencing entries and the field that holds the reference value (a string or a list of strings per entry).',
    },
    {
      name: 'to',
      type: '{ file?: string; arrays: string[]; field: string }',
      required: true,
      description:
        'Where every id must be covered: optional file ("." means this artifact, any other path is read relative to basePath), array selectors on the target document, and the id field on those arrays.',
    },
  ],
};

// ref-covers: every id in {to.file, to.arrays, to.field} must appear at least
// once among the values of {from.array, from.field} in this artifact. An
// unreadable or missing target file yields no findings and no error.
export const check: CheckImpl = ({ artifact, params, artifacts, basePath }) => {
  const findings: Finding[] = [];
  const from = (params.from || {}) as RefSpec;
  const to = (params.to || {}) as ToSpec;

  if (!from.array || !from.field || !Array.isArray(to.arrays) || !to.field) {
    return findings;
  }

  const toFile = to.file ? String(to.file) : null;
  let targetDoc: Record<string, unknown> | null;

  if (toFile === '.') {
    targetDoc = artifact;
  } else {
    const inline = artifacts && typeof artifacts === 'object' ? artifacts['target'] : undefined;
    if (inline && typeof inline === 'object' && !Array.isArray(inline)) {
      targetDoc = inline as Record<string, unknown>;
    } else if (toFile && basePath) {
      targetDoc = tryReadJson(path.resolve(basePath, toFile)) as Record<string, unknown> | null;
    } else {
      targetDoc = artifact;
    }
  }

  if (!targetDoc) return findings;

  const covered = new Set<string>();
  for (const item of getTopArray(artifact, from.array)) {
    const rawRefs = item?.[from.field];
    const refs: string[] = Array.isArray(rawRefs)
      ? rawRefs.map(String)
      : typeof rawRefs === 'string'
        ? [rawRefs]
        : [];
    for (const ref of refs) {
      if (ref) covered.add(ref);
    }
  }

  for (const arrayName of to.arrays) {
    // Plain names resolve as top-level arrays; path entries bearing [] resolve
    // through the artifact path resolver against the target document, matching
    // ref-exists. Each uncovered id yields one finding.
    const collections = arrayName.includes('[]')
      ? resolveCollections(targetDoc, arrayName)
      : [{ items: getTopArray(targetDoc, arrayName), location: arrayName }];
    for (const collection of collections) {
      for (const item of collection.items) {
        const id = item?.[to.field as string];
        if (typeof id === 'string' && !covered.has(id)) {
          findings.push({
            check: 'ref-covers',
            category: 'traceability',
            target: `${toFile || 'this artifact'}:${arrayName}.${to.field}`,
            finding: `'${id}' in '${arrayName}' is not covered by any ${from.array}.${from.field} entry`,
            fix: `Add '${id}' to a '${from.array}' entry's '${from.field}'`,
          });
        }
      }
    }
  }

  return findings;
};
