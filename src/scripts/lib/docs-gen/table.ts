/**
 * docs-gen table engine: parses markdown tables, renders them
 * deterministically, and merges generator-owned rows with preserved
 * agent-authored rows by key column (merge-by-key).
 *
 * Determinism contract: row order comes from the generator (sorted by the
 * provider); preserved rows not present in the generated set are appended
 * in their existing relative order; preserved columns are copied verbatim
 * from the existing row when the key matches. Identical inputs always
 * produce identical output bytes.
 */

import { DocsGenError } from './splice.ts';

const TABLE_LINE_RE = /^\s*\|.*\|\s*$/;
const SEPARATOR_LINE_RE = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;

export function isTableRow(line: string): boolean {
  return TABLE_LINE_RE.test(line) && !SEPARATOR_LINE_RE.test(line);
}

export function isTableSeparator(line: string): boolean {
  return SEPARATOR_LINE_RE.test(line);
}

/** Splits one markdown table row into cells, honoring \| escapes. */
export function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return body
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/**
 * Parses a markdown table starting at `start` (the header row). Returns
 * null when the block is not a table. The separator line is consumed.
 */
export function parseTableAt(
  lines: string[],
  start: number
): { header: string[]; rows: string[][]; end: number } | null {
  if (start >= lines.length || !isTableRow(lines[start])) return null;
  if (start + 1 >= lines.length || !isTableSeparator(lines[start + 1])) return null;
  const header = splitRow(lines[start]);
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && isTableRow(lines[i])) {
    rows.push(splitRow(lines[i]));
    i += 1;
  }
  return { header, rows, end: i };
}

/** Escapes a cell for markdown table rendering. */
export function tableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** Renders a markdown table. Cells are unpadded — wide cells waste tokens. */
export function renderTable(headers: string[], rows: string[][]): string[] {
  const columnCount = headers.length;
  const normalize = (row: string[]): string[] =>
    Array.from({ length: columnCount }, (_, i) => tableCell(row[i] ?? ''));
  const format = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  const out = [
    format(headers.map(tableCell)),
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) out.push(format(normalize(row)));
  return out;
}

/**
 * Merges generator-produced rows with preserved rows from the existing
 * table. Rows matching `keyColumn` are regenerated, except the columns in
 * `preserveColumns`, which are copied verbatim from the existing row
 * (judgment cells such as prose descriptions). Existing rows whose key is
 * absent from the generated set are appended in their original order
 * (agent-added rows survive). Sorts by `sortBy` when given.
 */
export function mergeTableRows(
  existing: string[][],
  generated: string[][],
  options: { keyColumn: number; preserveColumns?: number[]; sortBy?: number }
): string[][] {
  const existingByKey = new Map<string, string[]>();
  for (const row of existing) {
    const key = row[options.keyColumn] ?? '';
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }

  const generatedKeys = new Set<string>();
  const merged: string[][] = generated.map((row) => {
    generatedKeys.add(row[options.keyColumn] ?? '');
    const prior = existingByKey.get(row[options.keyColumn] ?? '');
    if (!prior || !options.preserveColumns || options.preserveColumns.length === 0) {
      return [...row];
    }
    const mergedRow = [...row];
    for (const column of options.preserveColumns) {
      if (prior[column] !== undefined) mergedRow[column] = prior[column];
    }
    return mergedRow;
  });

  for (const row of existing) {
    const key = row[options.keyColumn] ?? '';
    if (!generatedKeys.has(key)) merged.push([...row]);
  }

  if (options.sortBy !== undefined) {
    merged.sort((a, b) =>
      String(a[options.sortBy as number] ?? '').localeCompare(String(b[options.sortBy as number] ?? ''))
    );
  }
  return merged;
}

function compileHeadingRe(heading: string): RegExp {
  return new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
}

/**
 * Extracts the rows of the first table under a heading in a document.
 * Returns [] when the heading or a table under it is absent.
 */
export function tableRowsUnderHeading(content: string, heading: string): string[][] {
  const lines = content.split('\n');
  const headingPattern = compileHeadingRe(heading);
  for (let i = 0; i < lines.length; i += 1) {
    if (!headingPattern.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (isTableRow(lines[j])) {
        const parsed = parseTableAt(lines, j);
        return parsed ? parsed.rows : [];
      }
      if (lines[j].startsWith('#')) break;
    }
  }
  return [];
}
