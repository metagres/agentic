#!/usr/bin/env node
/**
 * generate_context.mjs — bundle a project into a single file for LLM context.
 *
 * Self-contained on purpose: Node builtins only, no npm packages, no
 * `package.json` required. Drop it anywhere and run `node generate_context.mjs`.
 *
 * The `.mjs` extension is deliberate. A `.js` file using `import` relies on
 * Node's syntax detection when no `package.json` exists, and that detection is
 * disabled the moment a `package.json` declares `"type": "commonjs"`. `.mjs` is
 * always ESM, so this file runs identically in module, commonjs, and
 * package-less directories.
 *
 * File selection is driven entirely by the project's `.contextignore` and
 * `.gitignore`, which are both honoured and combined: a path is excluded when
 * either excludes it. Those files are the source of truth for what belongs in
 * the context. The binary checks below are a safety net that keeps a corrupt
 * bundle from ever being written; anything they catch is reported as a gap in
 * the ignore configuration, not as a silent decision of this tool.
 */

import { createWriteStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- CONFIGURATION -----------------------------------------------------------

/** Directory to collect, relative to this script's own location. */
const INPUT_DIR = '.';

/** Bundle filename, written into the collected directory. */
const OUTPUT_FILE = 'llms.txt';

/** Skip individual files larger than this. 0 = no per-file limit. */
const MAX_FILE_SIZE_MB = 2;

/**
 * Abort if the bundle exceeds this. 0 = no total limit, which is the default:
 * silently truncating a context bundle destroys information without telling
 * anyone, so the size is reported and left for a human to act on.
 */
const MAX_TOTAL_MB = 0;

/** Fraction of control characters that marks a file as binary. */
const BINARY_CONTROL_RATIO = 0.3;

// --- CONSTANTS ---------------------------------------------------------------

/** Version-control internals: never context, never traversable. */
const ALWAYS_SKIP_DIRS = new Set(['.git', '.svn', '.hg', '.bzr']);

/** Filenames excluded by basename, regardless of location. */
const ALWAYS_SKIP_FILES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'composer.lock',
]);

/**
 * Used only when the collected project has neither `.contextignore` nor
 * `.gitignore`, so that a script dropped into an unfamiliar project still
 * avoids bundling `node_modules`. When either file exists, the project's own
 * rules are the only ones applied — this default is never merged in, because
 * doing so would exclude files the project deliberately did not exclude.
 */
const DEFAULT_IGNORE_PATTERNS = [
    '.git/', '.svn/', '.hg/', 'node_modules/', 'dist/', 'build/', 'out/', 'target/',
    'coverage/', '.next/', '.nuxt/', '.cache/', '.venv/', 'venv/', '__pycache__/',
    '*.min.js', '*.min.css', '*.map', '*.log', '*.lock', '.DS_Store', 'Thumbs.db',
];

/**
 * Binary-by-extension. Sniffing content alone is unreliable: Python pickle
 * files start with the protocol header `\x80\x05`, which contains no null byte
 * and so passes a null-byte test, while being pure binary. An explicit list is
 * cheap, deterministic, and catches that class of file outright.
 */
const BINARY_EXTENSIONS = new Set([
    // compiled / packaged
    '.pkl', '.pickle', '.pyc', '.pyo', '.so', '.dll', '.dylib', '.exe', '.class',
    '.jar', '.war', '.wasm', '.node', '.o', '.a', '.obj',
    // archives
    '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.tar',
    // databases
    '.db', '.sqlite', '.sqlite3', '.mdb',
    // raster / vector images and media
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tif', '.tiff',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.webm', '.flac', '.ogg',
    // fonts
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    // documents
    '.pdf',
]);

// --- GITIGNORE MATCHING ------------------------------------------------------

/**
 * Translates a gitignore glob into an unanchored RegExp source string.
 * `**` crosses directory boundaries, `*` and `?` do not.
 */
function globToRegExpSource(glob) {
    let out = '';
    let i = 0;

    while (i < glob.length) {
        const char = glob[i];

        if (char === '*') {
            let j = i;
            while (glob[j] === '*') j++;
            const run = j - i;

            if (run >= 2) {
                // `**/` consumes itself plus the slash and matches zero or more
                // leading directories, so `**/foo` matches `foo` and `a/b/foo`.
                if (glob[j] === '/') {
                    out += '(?:[^/]*/)*';
                    i = j + 1;
                    continue;
                }
                out += '.*';
                i = j;
                continue;
            }

            out += '[^/]*';
            i = j;
            continue;
        }

        if (char === '?') {
            out += '[^/]';
            i++;
            continue;
        }

        if (char === '[') {
            let j = i + 1;
            let cls = '';
            if (glob[j] === '!' || glob[j] === '^') {
                cls += '^';
                j++;
            }
            // A `]` immediately after the opening bracket is a literal.
            if (glob[j] === ']') {
                cls += '\\]';
                j++;
            }
            while (j < glob.length && glob[j] !== ']') {
                cls += glob[j] === '\\' ? '\\\\' : glob[j];
                j++;
            }
            if (j >= glob.length) {
                // Unterminated class: treat the bracket as a literal.
                out += '\\[';
                i++;
                continue;
            }
            out += `[${cls}]`;
            i = j + 1;
            continue;
        }

        out += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        i++;
    }

    return out;
}

/** Compiles one gitignore line. Returns null for blanks, comments, and `/`. */
function compileRule(line) {
    // Trailing whitespace is insignificant unless backslash-escaped.
    let pattern = line.replace(/(?<!\\)\s+$/, '');

    if (pattern === '' || pattern.startsWith('#')) return null;

    let negated = false;
    if (pattern.startsWith('!')) {
        negated = true;
        pattern = pattern.slice(1);
    }
    // A backslash escapes a leading `#` or `!`.
    if (pattern.startsWith('\\')) pattern = pattern.slice(1);

    let dirOnly = false;
    if (pattern.endsWith('/')) {
        dirOnly = true;
        pattern = pattern.slice(0, -1);
    }
    if (pattern === '') return null;

    // A slash anywhere but the end anchors the pattern to the ignore root;
    // otherwise it matches a basename at any depth.
    const anchored = pattern.includes('/');
    if (pattern.startsWith('/')) pattern = pattern.slice(1);

    const prefix = anchored ? '' : '(?:[^/]*/)*';
    const regex = new RegExp(`^${prefix}${globToRegExpSource(pattern)}$`);

    return { regex, negated, dirOnly };
}

/**
 * An ordered set of gitignore rules. Later rules win, so a negation can
 * re-include a path that an earlier rule excluded.
 */
class IgnoreSpec {
    constructor(patterns) {
        this.rules = patterns.map(compileRule).filter(Boolean);
        this.source = 'none';
    }

    /**
     * @param {string} relPath  project-relative, forward slashes, no leading ./
     * @param {boolean} isDir
     */
    ignores(relPath, isDir) {
        let ignored = false;
        for (const rule of this.rules) {
            if (rule.dirOnly && !isDir) continue;
            if (rule.regex.test(relPath)) ignored = !rule.negated;
        }
        return ignored;
    }
}

/**
 * The union of every ignore file found in the project. A path is excluded when
 * ANY of them excludes it, so the two files compose rather than compete: rules
 * a developer added to `.gitignore` hold even if `.contextignore` predates them.
 *
 * Negations are scoped to the file that declares them. A `!keep.log` in
 * `.gitignore` re-includes that file within `.gitignore` only; if
 * `.contextignore` also excludes `*.log`, the file stays excluded. Exclusions
 * are therefore monotone, which is what makes directory pruning sound.
 */
class IgnoreSet {
    constructor(specs) {
        this.specs = specs;
    }

    get sources() {
        return this.specs.map((s) => s.source);
    }

    get ruleCount() {
        return this.specs.reduce((n, s) => n + s.rules.length, 0);
    }

    /**
     * @param {string} relPath  project-relative, forward slashes, no leading ./
     * @param {boolean} isDir
     */
    ignores(relPath, isDir) {
        return this.specs.some((spec) => spec.ignores(relPath, isDir));
    }
}

/**
 * Loads every ignore file present in `rootDir` and combines them. Both
 * `.contextignore` and `.gitignore` are honoured; the order below only decides
 * which is reported first, not which wins.
 *
 * With neither file present, a built-in default stands in so that a script
 * dropped into an unfamiliar project still avoids bundling `node_modules`.
 */
async function loadIgnoreSet(rootDir) {
    const specs = [];

    for (const name of ['.contextignore', '.gitignore']) {
        let text;
        try {
            text = await fsp.readFile(path.join(rootDir, name), 'utf-8');
        } catch {
            continue; // absent or unreadable: try the next candidate
        }
        const spec = new IgnoreSpec(text.split(/\r?\n/));
        spec.source = name;
        specs.push(spec);
    }

    if (specs.length === 0) {
        const spec = new IgnoreSpec(DEFAULT_IGNORE_PATTERNS);
        spec.source = 'built-in default';
        specs.push(spec);
    }

    return new IgnoreSet(specs);
}

// --- BINARY DETECTION --------------------------------------------------------

/** Fraction of control characters (excluding tab, LF, CR) in the first 8KB. */
function controlRatio(buffer) {
    if (buffer.length === 0) return 0;
    let controls = 0;
    for (const byte of buffer) {
        if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f) {
            controls++;
        }
    }
    return controls / buffer.length;
}

/**
 * Decodes a file as text, or explains why it cannot be. Three signals, because
 * none alone is sufficient: the extension catches files whose leading bytes look
 * innocuous (pickle, gzip); a strict UTF-8 decode catches anything that is not
 * text at all, independent of size; and the control-character ratio catches
 * binary that happens to be valid UTF-8.
 *
 * @returns {{ok: true, content: string} | {ok: false, reason: string}}
 */
function decodeText(filePath, buffer) {
    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
        return { ok: false, reason: `binary extension (${ext})` };
    }

    // A non-UTF-8 byte sequence cannot be source text. Decoding with
    // replacement would silently corrupt it instead of rejecting it.
    let content;
    try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        return { ok: false, reason: 'binary content (not valid UTF-8)' };
    }

    if (controlRatio(buffer.subarray(0, 8192)) > BINARY_CONTROL_RATIO) {
        return { ok: false, reason: 'binary content (control characters)' };
    }

    return { ok: true, content };
}

// --- OUTPUT ------------------------------------------------------------------

/** A write stream that respects backpressure, so memory stays bounded. */
async function writeChunk(stream, text) {
    if (!stream.write(text)) {
        await new Promise((resolve) => stream.once('drain', resolve));
    }
}

// --- MAIN --------------------------------------------------------------------

async function main() {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const rootDir = path.resolve(scriptDir, INPUT_DIR);
    const scriptName = path.basename(fileURLToPath(import.meta.url));

    let rootStat;
    try {
        rootStat = await fsp.stat(rootDir);
    } catch {
        console.error(`❌ Input directory not found: ${rootDir}`);
        console.error(`   INPUT_DIR is "${INPUT_DIR}", resolved relative to ${scriptDir}`);
        process.exit(1);
    }
    if (!rootStat.isDirectory()) {
        console.error(`❌ INPUT_DIR is not a directory: ${rootDir}`);
        process.exit(1);
    }

    const outputPath = path.join(rootDir, OUTPUT_FILE);

    // Never bundle the bundle, or the script that is producing it.
    const skipFiles = new Set([...ALWAYS_SKIP_FILES, OUTPUT_FILE, scriptName]);

    const maxFileBytes = MAX_FILE_SIZE_MB > 0 ? MAX_FILE_SIZE_MB * 1024 * 1024 : Infinity;
    const maxTotalBytes = MAX_TOTAL_MB > 0 ? MAX_TOTAL_MB * 1024 * 1024 : Infinity;

    console.log(`📂 Collecting : ${rootDir}`);
    const ignoreSet = await loadIgnoreSet(rootDir);
    console.log(`📋 Ignore rules: ${ignoreSet.sources.join(' + ')} (${ignoreSet.ruleCount} rules)\n`);

    // --- Traverse ------------------------------------------------------------
    console.log('🔍 Scanning...');
    const queue = [rootDir];
    const candidates = [];
    let policySkipped = 0;

    while (queue.length > 0) {
        const currentDir = queue.shift();
        let entries;
        try {
            entries = await fsp.readdir(currentDir, { withFileTypes: true });
        } catch {
            continue; // unreadable directory: skip silently
        }

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');

            if (entry.isDirectory()) {
                if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
                if (ignoreSet.ignores(relPath, true)) {
                    policySkipped++;
                    continue; // pruned: children are not visited or counted
                }
                queue.push(fullPath);
            } else if (entry.isFile()) {
                if (skipFiles.has(entry.name)) continue;
                if (ignoreSet.ignores(relPath, false)) {
                    policySkipped++;
                    continue;
                }
                candidates.push(relPath);
            }
            // Symlinks are not followed: they duplicate content, can point
            // outside the project, and can form cycles.
        }
    }

    candidates.sort();

    // --- Filter and write ---------------------------------------------------
    console.log(`📄 Bundling ${candidates.length} candidate files into ${OUTPUT_FILE}...\n`);

    const stream = createWriteStream(outputPath, 'utf-8');
    // A listener must be attached before the first write: an unhandled 'error'
    // event on a stream is thrown, not ignored.
    let writeError = null;
    stream.on('error', (err) => { writeError = err; });

    /**
     * Files that the ignore files did NOT exclude but that could not be
     * bundled. Every entry is a configuration gap: by design, a file only
     * reaches this point if no ignore rule matched it.
     */
    const omitted = [];
    const written = [];
    let bytesWritten = 0;
    let truncated = false;

    try {
        await writeChunk(stream,
            'The following is the source code of a project. File selection follows the\n' +
            "project's .contextignore and .gitignore.\n" +
            'Each file is wrapped in <file> tags whose path attribute is relative to the\n' +
            'project root. Reference, edit, and create files using these paths.\n' +
            'A manifest of files that matched no ignore rule but could not be bundled\n' +
            'follows the last file.\n\n');

        for (const relPath of candidates) {
            const fullPath = path.join(rootDir, relPath);

            let stat;
            try {
                stat = await fsp.stat(fullPath);
            } catch {
                omitted.push({ relPath, reason: 'unreadable' });
                continue;
            }
            if (!stat.isFile()) continue;

            if (stat.size > maxFileBytes) {
                omitted.push({
                    relPath,
                    reason: `larger than ${MAX_FILE_SIZE_MB} MB (${formatBytes(stat.size)})`,
                });
                continue;
            }

            // Enforce the total budget before reading, so an oversized file is
            // never pulled into memory.
            if (bytesWritten + stat.size > maxTotalBytes) {
                truncated = true;
                omitted.push({ relPath, reason: 'beyond total bundle budget' });
                continue;
            }

            let buffer;
            try {
                buffer = await fsp.readFile(fullPath);
            } catch {
                omitted.push({ relPath, reason: 'read error' });
                continue;
            }

            const decoded = decodeText(fullPath, buffer);
            if (!decoded.ok) {
                omitted.push({ relPath, reason: decoded.reason });
                continue;
            }
            const { content } = decoded;

            // A `</file>` inside the content would end the block early and make
            // the rest of the bundle unreadable to the model.
            if (content.includes('</file>')) {
                omitted.push({ relPath, reason: 'content contains the closing delimiter' });
                continue;
            }

            const body = content.endsWith('\n') ? content : `${content}\n`;
            await writeChunk(stream, `<file path="${relPath}">\n${body}</file>\n\n`);

            written.push(relPath);
            bytesWritten += stat.size;
        }

        if (omitted.length > 0) {
            await writeChunk(stream, '<omitted>\n');
            await writeChunk(
                stream,
                'The following files matched no rule in .contextignore or .gitignore,\n' +
                'but could not be represented as text. They do not exist as far as this\n' +
                'context is concerned, and the ignore files should list them.\n\n'
            );
            for (const { relPath, reason } of omitted) {
                await writeChunk(stream, `- ${relPath} (${reason})\n`);
            }
            await writeChunk(stream, '</omitted>\n\n');
        }

        stream.end();
        // Wait for 'close', then surface any error that was recorded. Racing a
        // never-settling error promise against close would hang here instead.
        await new Promise((resolve) => stream.once('close', resolve));
        if (writeError) throw writeError;
    } catch (err) {
        stream.destroy();
        console.error('❌ Failed while writing the bundle:', err.message);
        process.exit(1);
    }

    // --- Report -------------------------------------------------------------
    const { size } = await fsp.stat(outputPath);

    console.log('-'.repeat(56));
    console.log('✅ Done');
    console.log(`   Files included    : ${written.length}`);
    console.log(`   Excluded by ignore: ${policySkipped}  (${ignoreSet.sources.join(' + ')})`);
    console.log(`   Unbundled         : ${omitted.length}`);
    console.log(`   Bundle size       : ${formatBytes(size)}  (~${Math.round(size / 4).toLocaleString()} tokens)`);
    console.log(`   Saved to          : ${outputPath}`);

    if (truncated) {
        console.log(`\n   ⚠️  Bundle hit MAX_TOTAL_MB (${MAX_TOTAL_MB}); the listing is incomplete.`);
    }
    if (size > 1024 * 1024) {
        console.log('   ⚠️  Bundle exceeds 1 MB; consider tightening .contextignore.');
    }
    if (omitted.length > 0) {
        console.log('\n   ⚠️  These files matched no ignore rule but could not be bundled.');
        console.log('      Add them to .contextignore so the exclusion is explicit:');
        for (const { relPath, reason } of omitted) {
            console.log(`     - ${relPath}  (${reason})`);
        }
    }
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
