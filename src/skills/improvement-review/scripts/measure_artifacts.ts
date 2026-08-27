// CMP-003 / API-001: deterministic artifact-volume measurement over
// docs/changes/. Dev-only helper for the improvement-review skill; never
// deployed. Plain ESM TypeScript executed directly by node (DEC-004) using
// node builtins only.
//
// Output contract (DM-004): fixed field order script, arguments, result,
// rows of label/value/unit/source. Default output aggregates per change and
// stays within 40 lines; --verbose adds per-file detail. Byte-identical for
// identical repository state (DEC-008 scopes this state-derived helper into
// the byte-identity contract).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = 'measure_artifacts.ts';

/** Repository root, resolved from this file's location (src/skills/improvement-review/scripts/). */
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);

function fail(cause: string): never {
  process.stderr.write(`[${SCRIPT}] ${cause}\n`);
  process.exit(1);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Code-unit sort — never locale-dependent, so output stays byte-identical. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** wc -l semantics: newline count plus one when the file lacks a trailing newline. */
function countLines(text: string): number {
  if (text.length === 0) return 0;
  const newlines = text.split('\n').length - 1;
  return text.endsWith('\n') ? newlines : newlines + 1;
}

interface Options {
  change: string | null;
  verbose: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { change: null, verbose: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--change') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        fail("usage: --change requires a slug value");
      }
      options.change = value;
      i += 1;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--help') {
      process.stdout.write(
        `Usage: node src/skills/improvement-review/scripts/${SCRIPT} [--change <slug>] [--verbose]\n`
      );
      process.exit(0);
    } else {
      fail(`usage: unknown argument '${arg}'`);
    }
  }

  return options;
}

/**
 * Recursively lists regular files under `dir` as paths relative to the change
 * root, sorted by code units. Dotfiles are skipped (transient atomic-write
 * temp files must not enter measurements). Unreadable directories fail naming
 * the path — zeros are never printed as data (AC-026).
 */
function listFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err: unknown) {
    fail(`unreadable path: ${dir} (${msg(err)})`);
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      listFiles(abs, out);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
}

function readLineCount(file: string): number {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err: unknown) {
    fail(`unreadable path: ${file} (${msg(err)})`);
  }
  return countLines(text);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const argvEcho = process.argv.slice(2).join(' ');

  const changesRoot = path.join(ROOT, 'docs', 'changes');

  // Missing docs/changes is an empty dataset, not an error (CMP-003): exit
  // zero with an explicit empty result instead of printing zero rows as data.
  if (!fs.existsSync(changesRoot)) {
    process.stdout.write(
      [
        `script: ${SCRIPT}`,
        `arguments: ${argvEcho}`,
        'result: empty',
        'note: no docs/changes directory exists',
        'rows:',
        '',
      ].join('\n')
    );
    return;
  }

  let changeDirs: string[] = [];
  try {
    changeDirs = fs
      .readdirSync(changesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort(compareStrings);
  } catch (err: unknown) {
    fail(`unreadable path: ${changesRoot} (${msg(err)})`);
  }

  if (options.change !== null) {
    changeDirs = changeDirs.filter((name) => name === options.change);
  }

  const perChange: { change: string; files: { file: string; lines: number }[]; total: number }[] =
    [];
  let grandTotal = 0;
  let fileCount = 0;

  for (const change of changeDirs) {
    const changeDir = path.join(changesRoot, change);
    const absFiles: string[] = [];
    listFiles(changeDir, absFiles);
    absFiles.sort(compareStrings);

    const files = absFiles.map((abs) => ({
      file: path.relative(changesRoot, abs),
      lines: readLineCount(abs),
    }));

    const total = files.reduce((sum, f) => sum + f.lines, 0);
    perChange.push({ change, files, total });
    grandTotal += total;
    fileCount += files.length;
  }

  const lines: string[] = [
    `script: ${SCRIPT}`,
    `arguments: ${argvEcho}`,
  ];

  if (perChange.length === 0) {
    lines.push(
      'result: empty',
      options.change === null
        ? 'note: no change folders with artifacts exist under docs/changes'
        : `note: no change folder matching --change ${options.change} under docs/changes`,
      'rows:',
      ''
    );
    process.stdout.write(lines.join('\n'));
    return;
  }

  lines.push('result: ok', 'rows:');

  for (const entry of perChange) {
    lines.push(
      `label=${entry.change} value=${entry.total} unit=lines source=docs/changes/${entry.change}`
    );
    if (options.verbose) {
      for (const f of entry.files) {
        lines.push(
          `label=${f.file} value=${f.lines} unit=lines source=docs/changes/${f.file}`
        );
      }
    }
  }

  lines.push(`label=total value=${grandTotal} unit=lines source=docs/changes`);
  lines.push(`label=changes value=${perChange.length} unit=count source=docs/changes`);
  lines.push(`label=files value=${fileCount} unit=count source=docs/changes`);
  lines.push('');

  process.stdout.write(lines.join('\n'));
}

main();
