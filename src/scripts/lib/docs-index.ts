import fs from 'node:fs';
import path from 'node:path';

export interface DocEntry {
  file: string;
}

/**
 * The delta-target registry is the docs/current directory itself (DEC-004):
 * loadDocsIndex returns one {file} entry per .md document, read from a sorted
 * readdir of the directory — no rendered artifact is parsed. An absent
 * docs/current directory yields an empty list; the call site warns
 * DOCS_CURRENT_MISSING and skips delta-target validation.
 */
export function loadDocsIndex(cwd: string): DocEntry[] {
  const dir = path.join(cwd, 'docs', 'current');

  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ file: `docs/current/${name}` }));
}

export function normalizeHeading(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/^#+\s*/, '')
    .trim();
}

export function headingExists(cwd: string, file: string, anchor: string): boolean {
  const abs = path.join(cwd, file);

  if (!fs.existsSync(abs)) return false;

  const content = fs.readFileSync(abs, 'utf8');
  const wanted = normalizeHeading(anchor);

  return content
    .split('\n')
    .some((line) => normalizeHeading(line) === wanted);
}
