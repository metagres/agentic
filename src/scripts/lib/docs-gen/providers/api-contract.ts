/**
 * api-contract provider: renders three regions inside
 * docs/current/api-contract.md — the Envelope field table (from
 * cli-envelope.schema.yaml; Notes cells preserved), the Schema
 * Reconciliation drift column (ajv compile of every schema asset), and
 * the error-catalog reference (errors.yaml codes with message, fix, and
 * makeError emit sites). Behavioral prose bullets stay agent-authored
 * outside every region.
 */

import fs from 'node:fs';
import path from 'node:path';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { readYaml } from '../../yaml-io.ts';
import { listFiles } from '../scans.ts';
import { mergeTableRows, renderTable, parseTableAt, isTableRow } from '../table.ts';
import type { ProviderContext, RegionProvider } from '../types.ts';

const REL_PATH = 'docs/current/api-contract.md';

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

interface SchemaNode {
  properties?: Record<string, { type?: string | string[]; enum?: unknown[]; items?: { type?: string } }>;
  required?: string[];
  additionalProperties?: boolean;
}

function typeOf(node: { type?: string | string[]; enum?: unknown[]; items?: { type?: string } }): string {
  if (Array.isArray(node.enum)) return node.enum.map(String).join(' \\| ');
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  if (type === 'array') return `${node.items?.type ?? 'object'}[]`;
  return type ?? 'object';
}

export const apiContractEnvelopeProvider: RegionProvider = {
  mode: 'region',
  render(ctx: ProviderContext): string[] {
    const schema = readYaml(`${ctx.root}/src/schemas/cli-envelope.schema.yaml`) as SchemaNode;
    const generated = Object.entries(schema.properties ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([field, node]) => [field, typeOf(node), '', 'src/schemas/cli-envelope.schema.yaml']);
    const rows = mergeTableRows(regionTableRows(ctx, 'api-contract-envelope'), generated, {
      keyColumn: 0,
      preserveColumns: [2],
    });
    return renderTable(['Field', 'Type', 'Notes', 'Evidence'], rows);
  },
};

export const apiContractSchemaReconciliationProvider: RegionProvider = {
  mode: 'region',
  render(ctx: ProviderContext): string[] {
    const schemasDir = path.join(ctx.root, 'src', 'schemas');
    const ajv = new Ajv({ allErrors: true, strict: false });
    try {
      addFormats(ajv);
    } catch {
      // Optional.
    }
    const files = fs
      .readdirSync(schemasDir)
      .filter((file) => file.endsWith('.yaml'))
      .sort();
    const existingRows = regionTableRows(ctx, 'api-contract-schema-reconciliation');
    const coverage = new Map(existingRows.map((row) => [row[0] ?? '', row[1] ?? '']));
    const generated = files.map((file) => {
      const rel = `src/schemas/${file}`;
      let drift = 'No';
      try {
        ajv.compile(readYaml(path.join(schemasDir, file)) as Record<string, unknown>);
      } catch (err) {
        drift = `Yes — ${err instanceof Error ? err.message : String(err)}`;
      }
      return [rel, coverage.get(rel) ?? '', drift];
    });
    return renderTable(['Schema File', 'Endpoints Covered', 'Drift'], generated);
  },
};

export const apiContractErrorCatalogProvider: RegionProvider = {
  mode: 'region',
  render(ctx: ProviderContext): string[] {
    const policy = readYaml(`${ctx.root}/src/policies/errors.yaml`) as {
      errors?: Record<string, { message?: string; fix?: string }>;
      warnings?: Record<string, { message?: string; fix?: string }>;
    };
    const sources = listFiles(ctx.root, ['src', 'bin'], ['.ts']);
    const rows: string[][] = [];
    for (const kind of ['errors', 'warnings'] as const) {
      for (const [code, entry] of Object.entries(policy[kind] ?? {})) {
        const emitSites: string[] = [];
        const patterns = [
          new RegExp(`makeError\\(\\s*['"]${code}['"]`, 'g'),
          new RegExp(`['"]${code}['"]`, 'g'),
        ];
        for (const file of sources) {
          const text = ctx.readExisting(file);
          if (patterns.some((pattern) => pattern.test(text))) emitSites.push(file);
        }
        rows.push([
          code,
          entry.message ?? '',
          entry.fix ?? '',
          emitSites.sort().join(', ') || '(catalog entry only)',
        ]);
      }
    }
    return renderTable(['Code', 'Message', 'Fix', 'Emitted at'], rows);
  },
};
