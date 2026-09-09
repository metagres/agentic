/**
 * conventions provider: renders the structural-checks reference region
 * inside docs/current/conventions.md — the capped check catalog with its
 * required parameters, path-addressed parameter slots, and the stages
 * that declare each check. Pattern prose stays agent-authored outside the
 * region.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readYaml } from '../../yaml-io.ts';
import { CHECK_CATALOG } from '../../checks/index.ts';
import { renderTable } from '../table.ts';
import type { RegionProvider } from '../types.ts';

export const conventionsChecksReferenceProvider: RegionProvider = {
  mode: 'region',
  render(ctx): string[] {
    const declaring = declaredBy(ctx.root);
    const rows = Object.entries(CHECK_CATALOG)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entry]) => [
        name,
        entry.requiredParams.join(', '),
        (entry.pathParams ?? []).map((param) => `${param.spec} (${param.kind})`).join(', ') || '—',
        declaring.get(name) ?? '(none declared)',
      ]);
    return renderTable(['Check', 'Required params', 'Path params', 'Declared by'], rows);
  },
};

function declaredBy(root: string): Map<string, string> {
  const stagesDir = path.join(root, 'src', 'stages');
  const out = new Map<string, string[]>();
  if (!fs.existsSync(stagesDir)) return new Map();
  for (const stage of fs.readdirSync(stagesDir).sort()) {
    const file = path.join(stagesDir, stage, 'structural-checks.yaml');
    if (!fs.existsSync(file)) continue;
    const doc = readYaml(file) as { checks?: { check?: string }[] } | null;
    for (const declaration of doc?.checks ?? []) {
      if (!declaration.check) continue;
      out.set(declaration.check, [...(out.get(declaration.check) ?? []), stage]);
    }
  }
  return new Map([...out.entries()].map(([name, stages]) => [name, stages.join(', ')]));
}
