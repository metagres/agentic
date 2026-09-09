/**
 * architecture provider: renders two regions inside
 * docs/current/architecture.md — the Tech Stack versions (from
 * package.json; Layer/Technology/Evidence judgment cells preserved by
 * merge-by-key) and the module import edges (static ESM scan of src/ and
 * bin/). Component boundaries and integration-point prose stay
 * agent-authored outside every region.
 */

import { scanImportEdges } from '../scans.ts';
import { mergeTableRows, renderTable, parseTableAt, isTableRow, tableRowsUnderHeading } from '../table.ts';
import type { ProviderContext, RegionProvider } from '../types.ts';

const REL_PATH = 'docs/current/architecture.md';

function regionTableRows(ctx: ProviderContext, regionId: string): string[][] {
  const content = ctx.readExisting(REL_PATH);
  const begin = `<!-- docs-gen:begin id="${regionId}" -->`;
  const end = `<!-- docs-gen:end id="${regionId}" -->`;
  const startIndex = content.indexOf(begin);
  if (startIndex === -1) return [];
  const endIndex = content.indexOf(end, startIndex);
  if (endIndex === -1) return [];
  const lines = content.slice(startIndex + begin.length, endIndex).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (isTableRow(lines[i])) {
      const parsed = parseTableAt(lines, i);
      return parsed ? parsed.rows : [];
    }
  }
  return [];
}

interface PackageJson {
  version?: string;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function versionFor(pkg: PackageJson, tech: string): string {
  const lower = tech.toLowerCase();
  if (lower === 'node.js' || lower.startsWith('node.js')) return pkg.engines?.node ?? '—';
  const versions: string[] = [];
  for (const scope of ['dependencies', 'devDependencies'] as const) {
    for (const [name, version] of Object.entries(pkg[scope] ?? {})) {
      if (lower.includes(name.toLowerCase())) versions.push(version);
    }
  }
  return versions.length > 0 ? versions.join(' / ') : '—';
}

export const architectureTechStackProvider: RegionProvider = {
  mode: 'region',
  render(ctx: ProviderContext): string[] {
    const pkg = JSON.parse(ctx.readExisting('package.json')) as PackageJson;
    const existingRows = regionTableRows(ctx, 'architecture-tech-stack');
    const generated = existingRows
      .map((row) => {
        const next = [...row];
        next[2] = versionFor(pkg, row[1] ?? '');
        return next;
      })
      .sort((a, b) => String(a[1] ?? '').localeCompare(String(b[1] ?? '')));
    return renderTable(['Layer', 'Technology', 'Version', 'Evidence'], generated);
  },
};

export const architectureImportGraphProvider: RegionProvider = {
  mode: 'region',
  render(ctx: ProviderContext): string[] {
    const counts = new Map<string, number>();
    for (const edge of scanImportEdges(ctx.root)) {
      const key = `${moduleOf(edge.from)}|${moduleOf(edge.to)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([key, count]) => {
        const [from, to] = key.split('|');
        return [from, to, String(count)];
      })
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    return renderTable(['From (module)', 'To (module)', 'Import edges'], rows);
  },
};

/** Module = the folder path of a file (self-edges collapse to the folder). */
function moduleOf(file: string): string {
  return file.split('/').slice(0, -1).join('/') + '/';
}

export { REL_PATH as ARCHITECTURE_REL_PATH, regionTableRows as architectureRegionRows };
