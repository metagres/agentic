/**
 * glossary provider: renders the entity field tables that have structured
 * schema sources as docs-gen regions inside docs/current/glossary.md.
 * Field/Type/Source come from the referenced draft-07 schema; Nullable is
 * derived from the parent node's required list. Rows for registry-derived
 * fields the schema does not declare (e.g. AgentRecord.effectiveModel)
 * survive as preserved rows via merge-by-key; Business Rules tables stay
 * agent-authored outside every region.
 */

import { readYaml } from '../../yaml-io.ts';
import { mergeTableRows, renderTable, parseTableAt, isTableRow } from '../table.ts';
import type { ProviderContext, RegionProvider } from '../types.ts';

const REL_PATH = 'docs/current/glossary.md';
const HEADERS = ['Field', 'Type', 'Nullable', 'Source'];

interface SchemaNode {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  items?: SchemaNode;
  $ref?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
}

function resolvePointer(schema: SchemaNode, pointer?: string): SchemaNode {
  if (!pointer) return schema;
  let node: SchemaNode = schema;
  for (const segment of pointer.split('/').filter(Boolean)) {
    const next = (node as unknown as Record<string, SchemaNode>)[segment];
    if (!next || typeof next !== 'object') {
      throw new Error(`docs-gen: pointer '${pointer}' does not resolve in schema`);
    }
    node = next;
  }
  return node;
}

function typeOf(node: SchemaNode): string {
  if (node.const !== undefined) return `const ${String(node.const)}`;
  if (Array.isArray(node.enum)) return `enum: ${node.enum.map(String).join(' | ')}`;
  if (node.$ref) return String(node.$ref);
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  if (type === 'array') return `${typeOf(node.items ?? {}) ?? 'object'}[]`;
  return type ?? 'object';
}

function rowsFor(ctx: ProviderContext, params: Record<string, unknown>): string[][] {
  const schemaRel = String(params.schema ?? '');
  const schema = readYaml(`${ctx.root}/${schemaRel}`) as SchemaNode;
  const node = resolvePointer(schema, params.pointer as string | undefined);
  const properties = node.properties ?? {};
  const required = new Set(node.required ?? []);
  const source = String(params.source ?? schemaRel);

  const existingRows = regionTableRows(ctx, String(params.regionId ?? ''));
  const generated = Object.entries(properties ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, child]) => [field, typeOf(child), required.has(field) ? 'No' : 'Yes', source]);
  return mergeTableRows(existingRows, generated, { keyColumn: 0 });
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

export function glossaryFieldsProvider(regionId: string): RegionProvider {
  return {
    mode: 'region',
    render(ctx: ProviderContext, params: Record<string, unknown>): string[] {
      return renderTable(HEADERS, rowsFor(ctx, { ...params, regionId }));
    },
  };
}
