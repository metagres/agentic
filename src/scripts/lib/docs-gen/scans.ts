/**
 * docs-gen shared scans: deterministic file-system and source-text scans
 * reused by several providers (dependency import sites, comment markers,
 * skipped tests, dead path references, module import edges). Every scan
 * walks the repository tree, skips build/runtime artifacts, sorts its
 * output, and never mutates anything — pure functions over the repo tree.
 */

import fs from 'node:fs';
import path from 'node:path';

export const SCAN_DIRS = ['src', 'bin', 'test'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.opencode', '.git', '.tmp']);

export function listFiles(
  root: string,
  dirs: string[] = SCAN_DIRS,
  extensions: string[] = ['.ts', '.js', '.mjs', '.cjs', '.yaml', '.yml', '.json']
): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path.join(abs, entry.name), `${rel}/${entry.name}`);
        continue;
      }
      if (!extensions.some((ext) => entry.name.endsWith(ext))) continue;
      out.push(`${rel}/${entry.name}`);
    }
  };
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    if (fs.existsSync(abs)) walk(abs, dir);
  }
  return out.sort();
}

/** Repo-relative locations where a package is imported (with site counts). */
export function findImportSites(root: string, packageName: string, files?: string[]): string[] {
  const targets = files ?? listFiles(root, ['src', 'bin'], ['.ts', '.js', '.mjs', '.cjs']);
  const hits = new Map<string, number>();
  const patterns = [
    new RegExp(`from ['"]${escapeRe(packageName)}(?:/|['"])`, 'g'),
    new RegExp(`import ['"]${escapeRe(packageName)}(?:/|['"])`, 'g'),
    new RegExp(`require\\(['"]${escapeRe(packageName)}(?:/|['"])`, 'g'),
  ];
  for (const rel of targets) {
    const text = safeRead(path.join(root, rel));
    if (!text) continue;
    let count = 0;
    for (const pattern of patterns) count += [...text.matchAll(pattern)].length;
    if (count > 0) hits.set(rel, count);
  }
  return [...hits.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rel, count]) => `${rel}${count > 1 ? ` (${count} sites)` : ''}`);
}

// Built from split words so the scanner's own definition never matches
// itself; only marker occurrences inside comment context are findings.
const MARKER_WORDS = ['TO' + 'DO', 'FIX' + 'ME', 'HACK', 'XXX', 'BUG', 'DEPREC' + 'ATED'];
const MARKER_RE = new RegExp(`\\b(${MARKER_WORDS.join('|')})\\b`);
const COMMENT_START_RE = /(?:^|\s)(?:\/\/|\/\*|\*|#|<!--)/;

export interface CommentMarkerHit {
  file: string;
  line: number;
  marker: string;
  text: string;
}

export function scanCommentMarkers(root: string, files?: string[]): CommentMarkerHit[] {
  const targets = files ?? listFiles(root, SCAN_DIRS);
  const hits: CommentMarkerHit[] = [];
  for (const rel of targets) {
    const text = safeRead(path.join(root, rel));
    if (!text) continue;
    text.split('\n').forEach((line, index) => {
      const commentStart = line.search(/(?:\/\/|\/\*|\*(?!\/)|#|<!--)/);
      if (commentStart === -1) return;
      const match = line.slice(commentStart).match(MARKER_RE);
      if (match) hits.push({ file: rel, line: index + 1, marker: match[1], text: line.trim() });
    });
  }
  return hits;
}

export interface SkippedTestHit {
  file: string;
  line: number;
  usage: string;
}

export function scanSkippedTests(root: string): SkippedTestHit[] {
  const hits: SkippedTestHit[] = [];
  const skipRe = /\.(skip|only)\b/;
  for (const rel of listFiles(root, ['test'])) {
    const text = safeRead(path.join(root, rel));
    if (!text) continue;
    text.split('\n').forEach((line, index) => {
      if (skipRe.test(line)) hits.push({ file: rel, line: index + 1, usage: line.trim() });
    });
  }
  return hits;
}

const PATH_TOKEN_RE = /(?:src|bin|test|docs)\/[A-Za-z0-9_./-]+/g;

export interface DeadReferenceHit {
  file: string;
  section: string;
  context: string;
  reference: string;
}

/**
 * Scans policy YAML assets for path-like references to files that do not
 * exist on disk (STALE-REF candidates). `section` records the nearest
 * two-space-indented key line (e.g. an error-code key) for locating the
 * finding inside the asset.
 */
export function scanDeadReferences(root: string): DeadReferenceHit[] {
  const hits: DeadReferenceHit[] = [];
  const assets = ['src/policies/errors.yaml'];
  const sectionRe = /^\s{2}([A-Z][A-Z_]+):\s*$/;
  for (const rel of assets) {
    const text = safeRead(path.join(root, rel));
    if (!text) continue;
    let section = '';
    text.split('\n').forEach((line, index) => {
      const sectionMatch = line.match(sectionRe);
      if (sectionMatch) section = sectionMatch[1];
      for (const match of line.matchAll(PATH_TOKEN_RE)) {
        const reference = match[0].replace(/[.,)\]]+$/, '');
        if (fs.existsSync(path.join(root, reference))) continue;
        hits.push({
          file: `${rel}:${index + 1}`,
          section,
          context: line.trim(),
          reference,
        });
      }
    });
  }
  return hits;
}

/**
 * Local ESM import edges between repo modules (src/, bin/): from-file,
 * to-file resolved from relative specifiers. External package imports are
 * excluded — cross-package edges belong to the dependency facts.
 */
export function scanImportEdges(root: string): EdgeHit[] {
  const files = listFiles(root, ['src', 'bin'], ['.ts']);
  const known = new Set(files);
  const hits: EdgeHit[] = [];
  for (const rel of files) {
    const text = safeRead(path.join(root, rel));
    if (!text) continue;
    const seen = new Set<string>();
    for (const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const base = path.posix.join(path.posix.dirname(rel), match[1]);
      const resolved = [base, `${base}.ts`, `${base}/index.ts`].find((candidate) => known.has(candidate));
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      hits.push({ from: rel, to: resolved, kind: 'import' });
    }
  }
  return hits.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

export interface EdgeHit {
  from: string;
  to: string;
  kind: string;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeRead(abs: string): string {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}
