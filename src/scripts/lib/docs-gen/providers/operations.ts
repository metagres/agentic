/**
 * operations provider: renders the four mechanical regions of
 * docs/current/operations.md — Commands, Testing, Environment, and
 * Deployment tables from package.json and repository scans. Purpose and
 * coverage cells and agent-added rows (dev-only skills, CLI usage
 * patterns, payload details) are judgment content preserved by
 * merge-by-key; the qualitative baselines section is agent-owned and
 * lives outside every region.
 */

import fs from 'node:fs';
import path from 'node:path';

import { listFiles } from '../scans.ts';
import { mergeTableRows, renderTable, splitRow, tableRowsUnderHeading, parseTableAt, isTableRow } from '../table.ts';
import type { ProviderContext, RegionProvider } from '../types.ts';

const REL_PATH = 'docs/current/operations.md';
const CMD_HEADERS = ['Command', 'Purpose', 'Evidence'];

interface PackageJson {
  scripts?: Record<string, string>;
}

function pkg(ctx: ProviderContext): PackageJson {
  return JSON.parse(ctx.readExisting('package.json')) as PackageJson;
}

/** Existing rows of the table currently inside a region (for merge-by-key). */
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

const scriptEntry = (name: string): string => `npm run ${name}`;

export const operationsCommandsProvider: RegionProvider = {
  mode: 'region',
  render(ctx: ProviderContext): string[] {
    const scripts = Object.entries(pkg(ctx).scripts ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const generated = scripts.map(([name]) => [
      scriptEntry(name),
      '',
      `package.json (scripts.${name})`,
    ]);
    const rows = mergeTableRows(regionTableRows(ctx, 'operations-commands'), generated, {
      keyColumn: 0,
      preserveColumns: [1, 2],
    });
    return renderTable(CMD_HEADERS, rows);
  },
};

export const operationsTestingProvider: RegionProvider = {
  mode: 'region',
  render(ctx: ProviderContext): string[] {
    const scripts = pkg(ctx).scripts ?? {};
    const names = Object.keys(scripts)
      .filter((name) => name === 'test' || name.startsWith('test:'))
      .sort();
    const generated = names.map((name) => [scriptEntry(name), '', 'package.json']);
    const rows = mergeTableRows(regionTableRows(ctx, 'operations-testing'), generated, {
      keyColumn: 0,
      preserveColumns: [1, 2],
    });
    return renderTable(['Test Command', 'Coverage Tool', 'Evidence'], rows);
  },
};

export const operationsEnvironmentProvider: RegionProvider = {
  mode: 'region',
  render(ctx: ProviderContext): string[] {
    const findings: string[][] = [];
    for (const rel of ['.env.example', 'docker-compose.yaml', 'docker-compose.yml']) {
      if (fs.existsSync(path.join(ctx.root, rel))) {
        findings.push([rel, 'declares environment variables', 'required', rel]);
      }
    }
    for (const file of listFiles(ctx.root, ['src', 'bin'], ['.ts'])) {
      const text = ctx.readExisting(file);
      if (/process\.env\.[A-Z_]/.test(text)) {
        findings.push([file, 'reads process.env at runtime', '—', file]);
      }
    }
    if (findings.length === 0) {
      return renderTable(
        ['Variable', 'Purpose', 'Required?', 'Evidence'],
        [['(none)', 'No .env.example or docker-compose in repository; no environment variables declared', '—', 'package.json, repository root']]
      );
    }
    return renderTable(['Variable', 'Purpose', 'Required?', 'Evidence'], findings);
  },
};

export const operationsDeploymentProvider: RegionProvider = {
  mode: 'region',
  render(ctx: ProviderContext): string[] {
    const scripts = pkg(ctx).scripts ?? {};
    const generated: string[][] = [];
    for (const name of ['deploy', 'deploy:smoke']) {
      if (scripts[name] !== undefined) {
        generated.push([`npm run ${name}`, '', 'package.json (scripts), bin/deploy-to-agent.ts']);
      }
    }
    const rows = mergeTableRows(regionTableRows(ctx, 'operations-deployment'), generated, {
      keyColumn: 0,
      preserveColumns: [1, 2],
    });
    return renderTable(['Target', 'Command/Trigger', 'Evidence'], rows);
  },
};
