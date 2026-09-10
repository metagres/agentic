// CMP-004 / API-002: deterministic envelope byte-size measurement per stage.
// Dev-only helper for the improvement-review skill; never deployed. Plain ESM
// TypeScript executed directly by node (DEC-004) using node builtins only.
//
// Discovers stage ids by directory scan of src/stages/ and measures exactly
// one envelope per real stage id by invoking node src/scripts/sdlc.ts
// <stage-id> --change <slug>. Mutation safety is mandatory per invocation
// class: the four review-stage invocations MUST pass --dry-run because a bare
// review invocation appends a round to the review file (round recording is
// gated on not-dry-run in src/scripts/lib/kinds/review.ts), while bare
// authoring, tasks, and aggregator invocations are verified read-only.
//
// Output contract (DM-004): rows of label/value/unit/source carrying stage,
// observed step, and JSON serialization bytes total plus bytes per frozen
// top-level field (--verbose). Byte-identical for identical repository state
// (DEC-008).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { STAGES, invocationClass } from './invocation_class.ts';

const SCRIPT = 'envelope_sizes.ts';

/** Repository root, resolved from this file's location (src/skills/improvement-review/scripts/). */
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);

/** The frozen CLI envelope top-level fields, in frozen order (invariant 8). */
const FROZEN_FIELDS = [
  'command',
  'step',
  'state',
  'instructions',
  'data',
  'errors',
  'warnings',
] as const;

function fail(cause: string): never {
  process.stderr.write(`[${SCRIPT}] ${cause}\n`);
  process.exit(1);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Options {
  change: string;
  verbose: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { change: '', verbose: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--change') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        fail('usage: --change requires a slug value');
      }
      options.change = value;
      i += 1;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--help') {
      process.stdout.write(
        `Usage: node src/skills/improvement-review/scripts/${SCRIPT} --change <slug> [--verbose]\n`
      );
      process.exit(0);
    } else {
      fail(`usage: unknown argument '${arg}'`);
    }
  }

  if (!options.change) {
    fail('usage: --change <slug> is required');
  }

  return options;
}

/**
 * Directory scan of src/stages/ (invariant 10). Every scanned folder must
 * carry its stage.yaml descriptor — a folder that cannot be scanned is a hard
 * failure naming the folder (API-002). Each of the nine measured stage ids
 * must be present in the scan result.
 */
function scanStageIds(): void {
  const stagesDir = path.join(ROOT, 'src', 'stages');

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(stagesDir, { withFileTypes: true });
  } catch (err: unknown) {
    fail(`cannot scan stage directory ${stagesDir}: ${msg(err)}`);
  }

  const discovered = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    if (!fs.existsSync(path.join(stagesDir, entry.name, 'stage.yaml'))) {
      fail(`stage folder '${entry.name}' cannot be scanned: missing stage.yaml descriptor`);
    }

    discovered.add(entry.name);
  }

  for (const stage of STAGES) {
    if (!discovered.has(stage.id)) {
      fail(`stage folder '${stage.id}' not found by src/stages directory scan`);
    }
  }
}

interface Measurement {
  step: string;
  total: number;
  fields: Record<string, number>;
}

function measureEnvelope(stageId: string, dryRun: boolean, slug: string): Measurement {
  const cli = path.join(ROOT, 'src', 'scripts', 'sdlc.ts');
  const args = [cli, stageId, '--change', slug];
  if (dryRun) args.push('--dry-run');

  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) {
    fail(`stage '${stageId}' invocation failed to spawn: ${msg(result.error)}`);
  }

  const stdout = result.stdout ?? '';

  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    fail(
      `stage '${stageId}' did not emit a parseable JSON envelope on stdout ` +
        `(exit_code=${result.status}); stdout head: ${stdout.slice(0, 200)}`
    );
  }

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail(`stage '${stageId}' emitted a non-object envelope`);
  }

  const record = envelope as Record<string, unknown>;
  const fields: Record<string, number> = {};

  for (const field of FROZEN_FIELDS) {
    const value = record[field];
    const serialized = value === undefined ? '' : JSON.stringify(value) ?? '';
    fields[field] = Buffer.byteLength(serialized, 'utf8');
  }

  const total = Buffer.byteLength(JSON.stringify(record) ?? '', 'utf8');
  const step = typeof record.step === 'string' ? record.step : 'unknown';

  return { step, total, fields };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const argvEcho = process.argv.slice(2).join(' ');

  scanStageIds();

  const lines: string[] = [
    `script: ${SCRIPT}`,
    `arguments: ${argvEcho}`,
    `dry_run_stages: ${STAGES.filter((s) => s.dryRun).map((s) => s.id).join(',')}`,
    'result: ok',
    'rows:',
  ];

  let grandTotal = 0;
  const classTotals = new Map<string, number>();

  for (const stage of STAGES) {
    const measurement = measureEnvelope(stage.id, stage.dryRun, options.change);
    const klass = invocationClass(stage.id);
    grandTotal += measurement.total;
    classTotals.set(klass, (classTotals.get(klass) ?? 0) + measurement.total);

    lines.push(
      `label=${stage.id} value=${measurement.total} unit=bytes source=step:${measurement.step} class=${klass}`
    );

    if (options.verbose) {
      for (const field of FROZEN_FIELDS) {
        lines.push(
          `label=${stage.id}:${field} value=${measurement.fields[field]} unit=bytes ` +
            `source=step:${measurement.step}`
        );
      }
    }
  }

  // Per-invocation-class rows: the before/after delta of an envelope-semantics
  // change (for example terse envelopes) is measurable per class instead of
  // blended into one total.
  for (const klass of ['detection', 'mutation'] as const) {
    lines.push(
      `label=${klass} value=${classTotals.get(klass) ?? 0} unit=bytes source=stages:${klass}`
    );
  }

  lines.push(`label=total value=${grandTotal} unit=bytes source=envelopes:${STAGES.length}`);
  lines.push(
    'notes:',
    '- envelope bytes scale with the envelope rendering semantics; when a change alters those',
    '  semantics (for example terse envelopes for mutation invocations), same-kind byte rows',
    '  across the change are incomparable and every affected envelope-byte baseline row becomes',
    '  an initial-baseline candidate per the re-baseline rule in SKILL.md section 4 — record the',
    '  fresh per-class rows instead of claiming a regression.',
    ''
  );

  process.stdout.write(lines.join('\n'));
}

main();
