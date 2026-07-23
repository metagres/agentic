#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';

export class ResolveRootError extends Error {
  constructor(message, candidates = []) {
    super(message);
    this.name = 'ResolveRootError';
    this.candidates = candidates;
  }
}

export function resolveRootOrError(
  dir,
  { cwd = process.cwd(), allowExternal = false } = {}
) {
  if (!dir || typeof dir !== 'string') {
    throw new ResolveRootError('A change directory or slug is required.');
  }

  const raw = dir.trim();
  const changesDir = path.join(cwd, 'docs', 'changes');

  const resolveExplicit = (p) => {
    const abs = path.resolve(cwd, p);

    if (!fs.existsSync(abs)) return null;

    const rel = path.relative(cwd, abs);

    const outsideRepo =
      rel === '..' ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel);

    if (!allowExternal && outsideRepo) {
      throw new ResolveRootError(
        `Refusing to use a directory outside the repository: ${p}`
      );
    }

    return abs;
  };

  if (raw.includes('/') || raw.startsWith('.')) {
    const abs = resolveExplicit(raw);

    if (abs) return abs;

    throw new ResolveRootError(`Change directory not found: ${raw}`);
  }

  if (!fs.existsSync(changesDir)) {
    throw new ResolveRootError(
      'docs/changes does not exist. Create a change directory first.'
    );
  }

  const entries = fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const lower = raw.toLowerCase();

  const exact = entries.find((name) => name.toLowerCase() === lower);

  if (exact) {
    return path.join(changesDir, exact);
  }

  const partial = entries.filter((name) =>
    name.toLowerCase().includes(lower)
  );

  if (partial.length === 1) {
    return path.join(changesDir, partial[0]);
  }

  if (partial.length > 1) {
    throw new ResolveRootError(
      `Ambiguous change directory '${raw}'. Matches: ${partial.join(', ')}`,
      partial
    );
  }

  throw new ResolveRootError(`No change directory matching '${raw}'.`);
}


