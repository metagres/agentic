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
  name: 'ref-exists',
  description:
    'Validates that every reference emitted by this artifact exists among the ids of a target document. The target document is resolved as: params.to.file of "." meaning this artifact, else the inline artifacts.target document, else the file params.to.file read relative to basePath.',
  params: [
    {
      name: 'from',
      type: '{ array: string; field: string }',
      required: true,
      description:
        'Where the references live in this artifact: the array of referencing entries and the field that holds the reference value (a string or a list of strings per entry).',
    },
    {
      name: 'to',
      type: '{ file?: string; arrays: string[]; field: string }',
      required: true,
      description:
        'Where valid ids come from: optional file ("." means this artifact, any other path is read relative to basePath), array selectors on the target document, and the id field on those arrays. Selectors may be path specs such as "epics[].features".',
    },
  ],
};

// ref-exists: references from {from.array, from.field} of this artifact must
// exist among the ids of {to.file, to.arrays, to.field} in a target document.
// An unreadable or missing target file yields no findings and no error.
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
      // No explicit target available: fall back to the artifact itself,
      // matching self-referencing use without configuration.
      targetDoc = artifact;
    }
  }

  if (!targetDoc) return findings;

  const validIds = new Set<string>();
  for (const arrayName of to.arrays) {
    // Plain names resolve as top-level arrays; path entries bearing [] resolve
    // through the artifact path resolver against the target document. The
    // valid-id set unions across all entries either way.
    const collections = arrayName.includes('[]')
      ? resolveCollections(targetDoc, arrayName)
      : [{ items: getTopArray(targetDoc, arrayName), location: arrayName }];
    for (const collection of collections) {
      for (const item of collection.items) {
        const id = item?.[to.field as string];
        if (typeof id === 'string') validIds.add(id);
      }
    }
  }

  const items = getTopArray(artifact, from.array);
  for (const item of items) {
    const itemId = item?.id ? String(item.id) : null;
    const rawRefs = item?.[from.field];
    const refs: string[] = Array.isArray(rawRefs)
      ? rawRefs.map(String)
      : typeof rawRefs === 'string'
        ? [rawRefs]
        : [];

    for (const refStr of refs) {
      if (refStr && !validIds.has(refStr)) {
        findings.push({
          check: 'ref-exists',
          category: 'traceability',
          target: `${from.array}[].${from.field}`,
          finding: `${itemId || 'an entry'} references missing ${from.field} value '${refStr}' in ${toFile || 'this artifact'}`,
          fix: `Add the missing ${from.field} entry or fix the reference`,
        });
      }
    }
  }

  return findings;
};
