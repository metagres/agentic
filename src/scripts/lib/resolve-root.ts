#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';

export class ResolveRootError extends Error {
  candidates: string[];
  available: string[]; // all change dir names in the searched changes dir (sorted; [] if dir missing)
  searched: string; // the docs/changes path that was searched

  constructor(
    message: string,
    details: {
      candidates?: string[];
      available?: string[];
      searched?: string;
    } = {}
  ) {
    super(message);
    this.name = 'ResolveRootError';
    this.candidates = details.candidates || [];
    this.available = details.available || [];
    this.searched = details.searched || '';
  }
}

export function normalizeName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tokensOf(name: string): string[] {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  return normalized.split('-');
}

function listDirNames(changesDir: string): string[] {
  if (!fs.existsSync(changesDir)) return [];
  return fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function availableSuffix(available: string[]): string {
  if (available.length === 0) return '';
  const shown = available.slice(0, 10).join(', ');
  const more = available.length > 10 ? ` (and ${available.length - 10} more)` : '';
  return ` Available changes: ${shown}${more}`;
}

// The single constructor of the project changes directory path. The cwd is
// the project root: the agent always invokes the CLI from the folder where it
// started, and docs/changes lives directly under it. The CLI script's own
// location (which may be a global skill dir) is never used to infer the
// project root, and no directory walking or marker heuristics apply.
export function changesDirFor(cwd: string): string {
  return path.join(cwd, 'docs', 'changes');
}

export function resolveRootOrError(
  dir: string,
  { cwd = process.cwd(), allowExternal = false }: { cwd?: string; allowExternal?: boolean } = {}
) {
  const changesDir = changesDirFor(cwd);

  const mkError = (
    message: string,
    extra: { candidates?: string[]; available?: string[] } = {}
  ): ResolveRootError =>
    new ResolveRootError(message, {
      candidates: extra.candidates || [],
      available:
        extra.available !== undefined ? extra.available : listDirNames(changesDir),
      searched: changesDir,
    });

  if (!dir || typeof dir !== 'string') {
    throw mkError('A change or slug is required.');
  }

  const raw = dir.trim();

  const resolveExplicit = (p: string): string | null => {
    const abs = path.resolve(cwd, p);

    if (!fs.existsSync(abs)) return null;

    const rel = path.relative(cwd, abs);

    const outsideRepo =
      rel === '..' ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel);

    if (!allowExternal && outsideRepo) {
      throw mkError(`Refusing to use a directory outside the repository: ${p}`);
    }

    return abs;
  };

  if (raw.includes('/') || raw.startsWith('.')) {
    const abs = resolveExplicit(raw);

    if (abs) return abs;

    const available = listDirNames(changesDir);
    throw mkError(`Change not found: ${raw}.` + availableSuffix(available), {
      available,
    });
  }

  if (!fs.existsSync(changesDir)) {
    throw mkError(
      `docs/changes does not exist under ${cwd} (searched: ${changesDir}). ` +
        'Run from the project root or pass the root explicitly with --cwd <project-root>.'
    );
  }

  const entries = listDirNames(changesDir);

  // 1. Case-insensitive exact match.
  const exact = entries.find((name) => name.toLowerCase() === raw.toLowerCase());

  if (exact) {
    return path.join(changesDir, exact);
  }

  const rawNormalized = normalizeName(raw);

  // 2. Normalized exact.
  if (rawNormalized) {
    const matches = entries.filter((name) => normalizeName(name) === rawNormalized);

    if (matches.length === 1) {
      return path.join(changesDir, matches[0]);
    }

    if (matches.length > 1) {
      throw mkError(
        `Ambiguous change '${raw}'. Matches: ${matches.join(', ')}`,
        { candidates: matches }
      );
    }
  }

  // 3. Token subset: every input token must appear in the entry's token set.
  const inputTokens = tokensOf(raw);

  if (inputTokens.length > 0) {
    const matches = entries.filter((entry) => {
      const entryTokens = tokensOf(entry);
      return inputTokens.every((token) => entryTokens.includes(token));
    });

    if (matches.length === 1) {
      return path.join(changesDir, matches[0]);
    }

    if (matches.length > 1) {
      throw mkError(
        `Ambiguous change '${raw}'. Matches: ${matches.join(', ')}`,
        { candidates: matches }
      );
    }
  }

  // 4. Normalized substring.
  if (rawNormalized) {
    const matches = entries.filter((name) => normalizeName(name).includes(rawNormalized));

    if (matches.length === 1) {
      return path.join(changesDir, matches[0]);
    }

    if (matches.length > 1) {
      throw mkError(
        `Ambiguous change '${raw}'. Matches: ${matches.join(', ')}`,
        { candidates: matches }
      );
    }
  }

  throw mkError(`No change matching '${raw}'.` + availableSuffix(entries), {
    available: entries,
  });
}
