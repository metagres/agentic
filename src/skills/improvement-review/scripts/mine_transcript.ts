// CMP-005 / API-003: post-hoc session-evidence extraction from explicitly
// supplied transcript files. Dev-only helper for the improvement-review skill;
// never deployed. Plain ESM TypeScript executed directly by node (DEC-004)
// using node builtins only.
//
// Accepts only caller-supplied file paths — it never discovers transcript
// stores and contains no hardcoded runtime locations (invariant 7, DEC-005).
// Extraction targets the generic line-oriented event grammar documented in
// SKILL.md: sdlc CLI invocation lines counted per command/stage, repeated
// identical consecutive command lines as wasted-round candidates, and
// delegation events capturing the three FR-002 sub-fields (delegation type,
// model resolution success/failure, rework needed). The source filename is
// printed beside every number. Zero parseable events in a supplied file
// produce an explicit zero-extraction report naming the file and a non-zero
// exit (AC-006). Byte-identical output for identical input files (DEC-008).
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = 'mine_transcript.ts';

function fail(cause: string): never {
  process.stderr.write(`[${SCRIPT}] ${cause}\n`);
  process.exit(1);
}

/**
 * Invocation event: a line containing an sdlc CLI call — either
 * `node <...>sdlc.ts|sdlc.js ...` or a bare `sdlc ...` — followed by the
 * command token (first non-flag argument). Documented in SKILL.md.
 */
const INVOCATION_RE = /(?:^|[\s`(])(?:node\s+\S*sdlc\.(?:ts|js)|\bsdlc)\s+(\S+)/;

/** Delegation event: a line mentioning delegation plus at least one sub-field token. */
const DELEGATION_RE = /\bdelegat(?:e|ed|es|ion)\b/i;
const DELEGATION_SUBFIELD_RE = /\b(type|model|rework)=/i;

/**
 * Failure event: a CLI envelope error signature — `"code": "<UPPER_SNAKE>"` in
 * raw or escaped JSON — counted only inside the envelope's `errors` array
 * (codes inside `warnings`, such as ARTIFACT_INITIALIZED, are not failures).
 * The window runs from the last `errors:[` anchor on the line to the first
 * `warnings:[` anchor after it, or end of line. Source reading does not match:
 * errors.yaml spells codes as YAML keys (`CODE:`) and engine code spells them
 * as single-quoted makeError('CODE') arguments. First match per line.
 * Documented in SKILL.md §5.
 */
const FAILURE_RE = /\\?"code\\?"\s*:\s*\\?"([A-Z][A-Z_]{3,})\\?"/;
const ERRORS_ANCHOR_RE = /\\?"errors\\?"\s*:\s*\[/g;
const WARNINGS_ANCHOR_RE = /\\?"warnings\\?"\s*:\s*\[/g;

function matchFailureCode(line: string): string | null {
  let lastErrorsAnchor = -1;
  for (const match of line.matchAll(ERRORS_ANCHOR_RE)) lastErrorsAnchor = match.index;
  if (lastErrorsAnchor === -1) return null;

  let windowEnd = line.length;
  for (const match of line.matchAll(WARNINGS_ANCHOR_RE)) {
    if (match.index > lastErrorsAnchor) {
      windowEnd = match.index;
      break;
    }
  }

  const failure = line.slice(lastErrorsAnchor, windowEnd).match(FAILURE_RE);
  return failure ? failure[1] : null;
}

interface DelegationEvent {
  type: string | null;
  model: string | null;
  rework: string | null;
}

interface FileStats {
  file: string;
  invocations: Map<string, number>;
  totalInvocations: number;
  wasted: Map<string, number>;
  wastedTotal: number;
  failures: Map<string, number>;
  failuresTotal: number;
  delegations: DelegationEvent[];
}

function extractSubField(line: string, key: string): string | null {
  const match = line.match(new RegExp(`\\b${key}=([^\\s\`'".,)]+)`, 'i'));
  return match ? match[1] : null;
}

function mineFile(file: string, text: string): FileStats {
  const stats: FileStats = {
    file,
    invocations: new Map(),
    totalInvocations: 0,
    wasted: new Map(),
    wastedTotal: 0,
    failures: new Map(),
    failuresTotal: 0,
    delegations: [],
  };

  const lines = text.split('\n');
  let previousCommandLine: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.length === 0) {
      previousCommandLine = null;
      continue;
    }

    const invocation = line.match(INVOCATION_RE);

    if (invocation) {
      const token = invocation[1];
      const command = token.startsWith('-') ? 'none' : token;
      stats.invocations.set(command, (stats.invocations.get(command) ?? 0) + 1);
      stats.totalInvocations += 1;

      // Wasted-round candidate: repeated identical consecutive command lines.
      if (previousCommandLine === line) {
        stats.wasted.set(line, (stats.wasted.get(line) ?? 0) + 1);
        stats.wastedTotal += 1;
      }
      previousCommandLine = line;
    } else {
      previousCommandLine = null;
    }

    if (DELEGATION_RE.test(line) && DELEGATION_SUBFIELD_RE.test(line)) {
      stats.delegations.push({
        type: extractSubField(line, 'type'),
        model: extractSubField(line, 'model'),
        rework: extractSubField(line, 'rework'),
      });
    }

    const failureCode = matchFailureCode(line);
    if (failureCode) {
      stats.failures.set(failureCode, (stats.failures.get(failureCode) ?? 0) + 1);
      stats.failuresTotal += 1;
    }
  }

  return stats;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function main(): void {
  const argv = process.argv.slice(2);
  const files: string[] = [];
  let verbose = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--help') {
      process.stdout.write(
        `Usage: node src/skills/improvement-review/scripts/${SCRIPT} <file>... [--verbose]\n`
      );
      process.exit(0);
    } else if (arg.startsWith('--')) {
      fail(`usage: unknown argument '${arg}'`);
    } else {
      files.push(arg);
    }
  }

  if (files.length === 0) {
    fail('usage: at least one transcript file path is required (caller-supplied files only)');
  }

  const argvEcho = argv.join(' ');
  const lines: string[] = [`script: ${SCRIPT}`, `arguments: ${argvEcho}`];

  const allStats: FileStats[] = [];
  const zeroExtractionFiles: string[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(path.resolve(file), 'utf8');
    } catch (err: unknown) {
      fail(
        `unreadable file: ${file} (${err instanceof Error ? err.message : String(err)})`
      );
    }

    const stats = mineFile(file, text);
    allStats.push(stats);

    if (
      stats.totalInvocations === 0 &&
      stats.delegations.length === 0 &&
      stats.failuresTotal === 0
    ) {
      zeroExtractionFiles.push(file);
    }
  }

  const hasEvents = (stats: FileStats): boolean =>
    stats.totalInvocations > 0 || stats.delegations.length > 0 || stats.failuresTotal > 0;

  lines.push(allStats.every(hasEvents) ? 'result: ok' : 'result: zero-extraction');
  lines.push('rows:');

  let totals = { invocations: 0, wasted: 0, failures: 0, delegations: 0 };

  for (const stats of allStats) {
    lines.push(
      `label=invocations value=${stats.totalInvocations} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=wasted_round_candidates value=${stats.wastedTotal} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=failures value=${stats.failuresTotal} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=delegations value=${stats.delegations.length} unit=events source=file:${stats.file}`
    );

    totals.invocations += stats.totalInvocations;
    totals.wasted += stats.wastedTotal;
    totals.failures += stats.failuresTotal;
    totals.delegations += stats.delegations.length;

    if (verbose) {
      const commands = [...stats.invocations.keys()].sort(compareStrings);
      for (const command of commands) {
        lines.push(
          `label=${path.basename(stats.file)}:invocations:${command} ` +
            `value=${stats.invocations.get(command)} unit=events source=file:${stats.file}`
        );
      }

      const wastedLines = [...stats.wasted.keys()].sort(compareStrings);
      for (const wastedLine of wastedLines) {
        lines.push(
          `label=${path.basename(stats.file)}:wasted_line ` +
            `value=${stats.wasted.get(wastedLine)} unit=events source=line:${wastedLine}`
        );
      }

      const failureCodes = [...stats.failures.keys()].sort(compareStrings);
      for (const code of failureCodes) {
        lines.push(
          `label=${path.basename(stats.file)}:failure_code:${code} ` +
            `value=${stats.failures.get(code)} unit=events source=file:${stats.file}`
        );
      }

      const byType = new Map<string, number>();
      const byModel = new Map<string, number>();
      const byRework = new Map<string, number>();
      for (const event of stats.delegations) {
        const type = event.type ?? 'unrecorded';
        const model = event.model ?? 'unrecorded';
        const rework = event.rework ?? 'unrecorded';
        byType.set(type, (byType.get(type) ?? 0) + 1);
        byModel.set(model, (byModel.get(model) ?? 0) + 1);
        byRework.set(rework, (byRework.get(rework) ?? 0) + 1);
      }
      for (const [key, group] of [
        ['delegation_type', byType],
        ['delegation_model', byModel],
        ['delegation_rework', byRework],
      ] as const) {
        for (const value of [...group.keys()].sort(compareStrings)) {
          lines.push(
            `label=${path.basename(stats.file)}:${key}:${value} ` +
              `value=${group.get(value)} unit=events source=file:${stats.file}`
          );
        }
      }
    }
  }

  if (allStats.length > 1) {
    lines.push(`label=total value=${totals.invocations} unit=events source=files:invocations`);
    lines.push(
      `label=total value=${totals.wasted} unit=events source=files:wasted_round_candidates`
    );
    lines.push(`label=total value=${totals.failures} unit=events source=files:failures`);
    lines.push(`label=total value=${totals.delegations} unit=events source=files:delegations`);
  }

  // Explicit zero-extraction report naming each event-less file (AC-006):
  // empty numbers are never silently emitted as data.
  if (zeroExtractionFiles.length > 0) {
    lines.push('zero_extraction_report:');
    for (const file of zeroExtractionFiles) {
      lines.push(`file: ${file} (0 parseable session events under the documented grammar)`);
    }
  }

  lines.push('');
  process.stdout.write(lines.join('\n'));

  if (zeroExtractionFiles.length > 0) {
    process.exitCode = 1;
  }
}

main();
