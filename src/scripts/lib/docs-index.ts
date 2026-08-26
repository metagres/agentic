import fs from 'node:fs';
import path from 'node:path';

export interface DocEntry {
  file: string;
  purpose: string;
  when: string;
  notes: string;
}

export function parseDocsIndex(content: string): DocEntry[] {
  const docs: DocEntry[] = [];
  const lines = String(content || '').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('|')) continue;
    if (trimmed.includes('---')) continue;

    const cells = trimmed
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);

    if (cells.length < 2) continue;

    // Accept both 'docs/current/<name>' and bare '<name>' forms; the index
    // uses bare filenames, so normalize them to the prefixed file key.
    const raw = cells[0];
    const file = raw.startsWith('docs/current/') ? raw : `docs/current/${raw}`;

    // Quality filter: a real document row's first cell always ends with
    // '.md'. Header and noise rows of auxiliary tables ('File', '#',
    // numbered checks, notes) would otherwise become pseudo-docs.
    if (!file.endsWith('.md')) continue;

    docs.push({
      file,
      purpose: cells[1] || '',
      when: cells[2] || '',
      notes: cells[3] || '',
    });
  }

  return docs;
}

export function loadDocsIndex(cwd: string): DocEntry[] {
  const file = path.join(cwd, 'docs', 'current', 'index.md');

  if (!fs.existsSync(file)) return [];

  const content = fs.readFileSync(file, 'utf8');
  return parseDocsIndex(content);
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


