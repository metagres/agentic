import fs from 'node:fs';
import path from 'node:path';

export function parseDocsIndex(content) {
  const docs = [];
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

    const file = cells[0];

    if (!file.startsWith('docs/current/')) continue;

    docs.push({
      file,
      purpose: cells[1] || '',
      when: cells[2] || '',
      notes: cells[3] || '',
    });
  }

  return docs;
}

export function loadDocsIndex(cwd) {
  const file = path.join(cwd, 'docs', 'current', 'index.md');

  if (!fs.existsSync(file)) return [];

  const content = fs.readFileSync(file, 'utf8');
  return parseDocsIndex(content);
}

export function normalizeHeading(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/^#+\s*/, '')
    .trim();
}

export function headingExists(cwd, file, anchor) {
  const abs = path.join(cwd, file);

  if (!fs.existsSync(abs)) return false;

  const content = fs.readFileSync(abs, 'utf8');
  const wanted = normalizeHeading(anchor);

  return content
    .split('\n')
    .some((line) => normalizeHeading(line) === wanted);
}


