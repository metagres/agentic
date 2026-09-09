// CMP-005 / API-003: post-hoc session-evidence extraction from explicitly
// supplied transcript files. Dev-only helper for the improvement-review skill;
// never deployed. Plain ESM TypeScript executed directly by node (DEC-004)
// using node builtins only.
//
// Accepts only caller-supplied file paths — it never discovers transcript
// stores and contains no hardcoded runtime locations (invariant 7, DEC-005).
// Extraction targets the generic line-oriented event grammar documented in
// SKILL.md: sdlc CLI invocation lines counted per command/stage, repeated
// identical consecutive command lines as wasted-round candidates, ack-repeat
// candidates (consecutive invocations returning an identical instructions
// text), envelope error signatures counted per code, tool-call failure
// signatures (schema errors, exact-match edit failures) counted per
// signature, source-exploration events (codegraph explores, grep/rg naming
// src/ paths), diagnosis-loop candidates (exploration runs following a
// blocked envelope), and delegation events capturing the three FR-002
// sub-fields (delegation type, model resolution success/failure, rework
// needed). The source filename is printed beside every number. Zero
// parseable events in a supplied file produce an explicit zero-extraction
// report naming the file and a non-zero exit (AC-006). Byte-identical output
// for identical input files (DEC-008).
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

/**
 * Tool-call failure event: a line carrying a known tool-call failure
 * signature — schema errors and exact-match edit failures — counted per
 * signature (first matching signature per line). The signature is only
 * read inside a raw or escaped-JSON `"error": "` field anchor, mirroring
 * the errors-array window of the envelope-failure rule: tool-runtime
 * results match, quoted prose and engine source shapes (makeError calls)
 * never do. The catalog is closed: signatures spell the tool-runtime
 * phrasing of the failure classes observed in reviewed sessions, not
 * generic error words. Tool failures also arm the diagnosis-loop detector,
 * like blocked envelopes do.
 */
const TOOL_ERROR_ANCHOR_RE = /\\?"error\\?"\s*:\s*\\?"/;
const TOOL_FAILURE_SIGNATURES: { signature: string; pattern: RegExp }[] = [
  {
    signature: 'edit-not-found',
    pattern:
      /\bCould not find oldString in the file\b|\boldString not found in file\b|\bString to replace not found in file\b/,
  },
  {
    signature: 'tool-schema-error',
    pattern: /\bSchemaError\b|\bPlease rewrite the input so it satisfies the expected schema\b/,
  },
];

/**
 * Source-exploration event: a codegraph-explore tool call, or a grep/rg
 * command line naming a src/ path. Counted per kind (codegraph | grep).
 */
const CODEGRAPH_EXPLORE_RE = /codegraph\S*explore/;
const GREP_SRC_RE = /\b(?:grep|rg)\s[^;|]*\bsrc\//;

/**
 * Blocked-envelope anchor: a raw or escaped-JSON `"state": "blocked"` field.
 * Together with envelope error signatures and tool-call failures it arms the
 * diagnosis-loop detector.
 */
const BLOCKED_STATE_RE = /\\?"state\\?"\s*:\s*\\?"blocked\\?"/;

/**
 * Ack-repeat candidate: consecutive CLI invocations whose returned envelope
 * instructions text is identical — the repeated-ack pattern distinct from
 * the identical-command-line wasted-round rule (command lines differ, the
 * returned instructions do not). The instructions slice runs from the
 * raw or escaped-JSON `"instructions": "` anchor to the next `"data"` anchor
 * on the same line (or end of line); only the first instructions anchor per
 * line is read. A slice is attributed to an invocation only when an
 * invocation event was seen since the previous attributed slice, so the
 * duplicate envelope copies a transcript may carry for one invocation never
 * count as repeats.
 */
const INSTRUCTIONS_ANCHOR_RE = /\\?"instructions\\?"\s*:\s*\\?"/;
const DATA_ANCHOR_RE = /\\?"data\\?"\s*:/;

/** Extraction threshold N: a post-block exploration run of any length counts. */
const DIAGNOSIS_LOOP_MIN_EXPLORATIONS = 1;

/** First tool-failure signature inside an `"error"` field anchor, by catalog order. */
function matchToolFailure(line: string): string | null {
  if (!TOOL_ERROR_ANCHOR_RE.test(line)) return null;
  for (const { signature, pattern } of TOOL_FAILURE_SIGNATURES) {
    if (pattern.test(line)) return signature;
  }
  return null;
}

/**
 * Instructions slice for ack-repeat comparison: from the instructions anchor
 * through the next data anchor (or end of line). Identical instructions
 * yield identical slices regardless of the surrounding envelope payload.
 */
function instructionsSlice(line: string): string | null {
  const anchor = INSTRUCTIONS_ANCHOR_RE.exec(line);
  if (!anchor) return null;
  const start = anchor.index;
  const rest = line.slice(start + anchor[0].length);
  const data = DATA_ANCHOR_RE.exec(rest);
  const end = data ? start + anchor[0].length + data.index : line.length;
  return line.slice(start, end);
}

function explorationKind(line: string): string {
  return CODEGRAPH_EXPLORE_RE.test(line) ? 'codegraph' : 'grep';
}

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
  ackRepeatTotal: number;
  failures: Map<string, number>;
  failuresTotal: number;
  toolFailures: Map<string, number>;
  toolFailuresTotal: number;
  explorations: Map<string, number>;
  explorationsTotal: number;
  diagnosisLoopTotal: number;
  diagnosisLoopRuns: number[];
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
    ackRepeatTotal: 0,
    failures: new Map(),
    failuresTotal: 0,
    toolFailures: new Map(),
    toolFailuresTotal: 0,
    explorations: new Map(),
    explorationsTotal: 0,
    diagnosisLoopTotal: 0,
    diagnosisLoopRuns: [],
    delegations: [],
  };

  const lines = text.split('\n');
  let previousCommandLine: string | null = null;

  // Ack-repeat state: an instructions slice is only attributed to an
  // invocation when an invocation event was seen since the previous
  // attributed slice, so duplicate envelope copies for one invocation
  // never count as repeats.
  let pendingInvocation = false;
  let lastInstructionsSlice: string | null = null;

  // Diagnosis-loop state: a blocked envelope (state:"blocked", an envelope
  // error signature, or a tool-call failure) arms the detector; an sdlc
  // invocation disarms it and ends the current exploration run. Non-event
  // lines (prose, file reads, blank lines) neither break a run nor re-arm.
  let blockedArmed = false;
  let inLoopRun = false;
  let loopRunEvents = 0;

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
      pendingInvocation = true;
      blockedArmed = false;
      inLoopRun = false;
      loopRunEvents = 0;

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
      blockedArmed = true;
    }

    const toolFailure = matchToolFailure(line);
    if (toolFailure) {
      stats.toolFailures.set(toolFailure, (stats.toolFailures.get(toolFailure) ?? 0) + 1);
      stats.toolFailuresTotal += 1;
      blockedArmed = true;
    }

    if (BLOCKED_STATE_RE.test(line)) {
      blockedArmed = true;
    }

    if (CODEGRAPH_EXPLORE_RE.test(line) || GREP_SRC_RE.test(line)) {
      const kind = explorationKind(line);
      stats.explorations.set(kind, (stats.explorations.get(kind) ?? 0) + 1);
      stats.explorationsTotal += 1;

      if (blockedArmed) {
        loopRunEvents += 1;
        if (!inLoopRun && loopRunEvents >= DIAGNOSIS_LOOP_MIN_EXPLORATIONS) {
          stats.diagnosisLoopTotal += 1;
          inLoopRun = true;
          stats.diagnosisLoopRuns.push(loopRunEvents);
        } else if (inLoopRun) {
          stats.diagnosisLoopRuns[stats.diagnosisLoopRuns.length - 1] = loopRunEvents;
        }
      }
    }

    const slice = instructionsSlice(line);
    if (slice !== null && pendingInvocation) {
      if (slice === lastInstructionsSlice) {
        stats.ackRepeatTotal += 1;
      }
      lastInstructionsSlice = slice;
      pendingInvocation = false;
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

  const hasEvents = (stats: FileStats): boolean =>
    stats.totalInvocations > 0 ||
    stats.delegations.length > 0 ||
    stats.failuresTotal > 0 ||
    stats.toolFailuresTotal > 0 ||
    stats.explorationsTotal > 0 ||
    stats.diagnosisLoopTotal > 0 ||
    stats.ackRepeatTotal > 0;

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

    if (!hasEvents(stats)) {
      zeroExtractionFiles.push(file);
    }
  }

  lines.push(allStats.every(hasEvents) ? 'result: ok' : 'result: zero-extraction');
  lines.push('rows:');

  let totals = {
    invocations: 0,
    wasted: 0,
    ackRepeats: 0,
    failures: 0,
    toolFailures: 0,
    explorations: 0,
    diagnosisLoops: 0,
    delegations: 0,
  };

  for (const stats of allStats) {
    lines.push(
      `label=invocations value=${stats.totalInvocations} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=wasted_round_candidates value=${stats.wastedTotal} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=ack_repeat_candidates value=${stats.ackRepeatTotal} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=failures value=${stats.failuresTotal} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=tool_failures value=${stats.toolFailuresTotal} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=explorations value=${stats.explorationsTotal} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=diagnosis_loop_candidates value=${stats.diagnosisLoopTotal} unit=events source=file:${stats.file}`
    );
    lines.push(
      `label=delegations value=${stats.delegations.length} unit=events source=file:${stats.file}`
    );

    totals.invocations += stats.totalInvocations;
    totals.wasted += stats.wastedTotal;
    totals.ackRepeats += stats.ackRepeatTotal;
    totals.failures += stats.failuresTotal;
    totals.toolFailures += stats.toolFailuresTotal;
    totals.explorations += stats.explorationsTotal;
    totals.diagnosisLoops += stats.diagnosisLoopTotal;
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

      const toolSignatures = [...stats.toolFailures.keys()].sort(compareStrings);
      for (const signature of toolSignatures) {
        lines.push(
          `label=${path.basename(stats.file)}:tool_failure:${signature} ` +
            `value=${stats.toolFailures.get(signature)} unit=events source=file:${stats.file}`
        );
      }

      const explorationKinds = [...stats.explorations.keys()].sort(compareStrings);
      for (const kind of explorationKinds) {
        lines.push(
          `label=${path.basename(stats.file)}:exploration:${kind} ` +
            `value=${stats.explorations.get(kind)} unit=events source=file:${stats.file}`
        );
      }

      for (const runEvents of stats.diagnosisLoopRuns) {
        lines.push(
          `label=${path.basename(stats.file)}:diagnosis_loop_run ` +
            `value=${runEvents} unit=events source=file:${stats.file}`
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
    lines.push(
      `label=total value=${totals.ackRepeats} unit=events source=files:ack_repeat_candidates`
    );
    lines.push(`label=total value=${totals.failures} unit=events source=files:failures`);
    lines.push(`label=total value=${totals.toolFailures} unit=events source=files:tool_failures`);
    lines.push(`label=total value=${totals.explorations} unit=events source=files:explorations`);
    lines.push(
      `label=total value=${totals.diagnosisLoops} unit=events source=files:diagnosis_loop_candidates`
    );
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
