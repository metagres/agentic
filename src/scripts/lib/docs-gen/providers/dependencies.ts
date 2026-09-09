/**
 * dependencies provider: renders docs/current/dependencies.md as a
 * whole-file generator. Name/version come from package.json; evidence is
 * computed from import sites (runtime) and root config mentions (dev);
 * the Role column is judgment content preserved from the existing file by
 * merge-by-key, as are agent-added rows for dependencies the scanners
 * cannot derive.
 */

import { findImportSites } from '../scans.ts';
import { mergeTableRows, renderTable, tableRowsUnderHeading } from '../table.ts';
import type { FileProvider, ProviderContext } from '../types.ts';

const REL_PATH = 'docs/current/dependencies.md';
const TABLE_HEADERS = ['Name', 'Version', 'Role', 'Evidence'];
const CONFIG_FILES = ['package.json', 'tsconfig.json', 'tsup.config.ts'];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export const dependenciesProvider: FileProvider = {
  mode: 'file',
  render(ctx: ProviderContext): string[] {
    const pkg = readPackageJson(ctx.readExisting('package.json'));
    const existing = ctx.readExisting(REL_PATH);
    const runtimeRows = dependencyTable(
      existing,
      'Key Dependencies',
      Object.entries(pkg.dependencies ?? {}),
      'runtime',
      ctx
    );
    const devRows = dependencyTable(
      existing,
      'Dev Dependencies',
      Object.entries(pkg.devDependencies ?? {}),
      'dev',
      ctx
    );

    return [
      '# dependencies.md',
      '',
      '## Key Dependencies',
      '',
      ...renderTable(TABLE_HEADERS, runtimeRows),
      '',
      '## Dev Dependencies',
      '',
      ...renderTable(TABLE_HEADERS, devRows),
      '',
    ];
  },
};

function dependencyTable(
  existing: string,
  heading: string,
  entries: [string, string][],
  scope: 'runtime' | 'dev',
  ctx: ProviderContext
): string[][] {
  const existingRows = tableRowsUnderHeading(existing, heading);
  const generated = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => [
      name,
      version,
      '',
      scope === 'runtime' ? runtimeEvidence(ctx, name) : devEvidence(ctx, name),
    ]);
  return mergeTableRows(existingRows, generated, { keyColumn: 0, preserveColumns: [2] });
}

function runtimeEvidence(ctx: ProviderContext, name: string): string {
  const sites = [
    ...findImportSites(ctx.root, name),
    ...findImportSites(ctx.root, name, ['generate_context.js']),
  ];
  if (sites.length === 0) {
    throw new Error(
      `docs-gen: dependency '${name}' is never imported in src/, bin/, or repo-root scripts — remove it from package.json or declare its consumer`
    );
  }
  return sites.join(', ');
}

function devEvidence(ctx: ProviderContext, name: string): string {
  const sites: string[] = [];
  for (const rel of CONFIG_FILES) {
    if (ctx.readExisting(rel).includes(name) && !sites.includes(rel)) sites.push(rel);
  }
  for (const site of findImportSites(ctx.root, name, ['tsup.config.ts'])) {
    const file = site.split(' ')[0];
    if (!sites.includes(file)) sites.push(file);
  }
  return sites.length > 0 ? sites.join(', ') : 'package.json';
}

function readPackageJson(raw: string): PackageJson {
  if (!raw) throw new Error('docs-gen: package.json is missing');
  return JSON.parse(raw) as PackageJson;
}
