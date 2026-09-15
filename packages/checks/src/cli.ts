#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { checks, checkHelp, runCheck } from './registry.ts';
import { parseJson, readJson } from './json-io.ts';
import type { Finding } from './types.ts';

/** Output sinks for the CLI, injectable so tests can capture output. */
export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const USAGE = `Usage: checks <command> [options]

Commands:
  list                     List every supported check with its description.
  help <check>             Show the parameter documentation of a check.
  <check> --help           Same as: help <check>.
  <check> --artifact <file.json> [options]
                           Fire one check against a JSON artifact.

Options for running a check:
  --artifact <file.json>   JSON document to validate; "-" reads stdin. Required.
  --params '<json>'        Check parameters as an inline JSON object.
  --params-file <file>     Check parameters from a JSON file.
  --artifacts '<json>'     Named secondary JSON documents, for example
                           '{"target": {...}}'.
  --basePath <dir>         Base directory used to resolve file references
                           inside parameters.

Exit codes:
  0  the check produced no findings
  1  the check produced findings (printed as a JSON array)
  2  usage error, unknown check, or invalid JSON input
`;

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

// Minimal dependency-free argument parser: --key value, --key=value, and
// bare --key flags. Everything else is collected as positional arguments.
function parseArgv(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[arg.slice(2)] = next;
      i++;
    } else {
      flags[arg.slice(2)] = true;
    }
  }

  return { positional, flags };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(io: CliIo, message: string): number {
  io.err(`error: ${message}\n`);
  return 2;
}

/**
 * Runs the checks CLI. Returns the process exit code:
 * 0 = no findings, 1 = findings, 2 = usage or input error.
 */
export function runCli(
  argv: string[],
  io: CliIo = defaultIo
): number {
  const { positional, flags } = parseArgv(argv);
  const command = positional[0];

  if (command === undefined || (flags.help === true && command === 'help' && positional.length === 1)) {
    io.out(USAGE);
    return 0;
  }

  if (command === 'list') {
    for (const [name, entry] of Object.entries(checks)) {
      io.out(`${name} — ${entry.manifest.description}\n`);
    }
    return 0;
  }

  if (command === 'help' || flags.help === true) {
    const name = command === 'help' ? positional[1] : command;
    if (!name || name === 'help') {
      io.out(USAGE);
      return 0;
    }
    if (!checks[name]) {
      return fail(io, `Unknown check '${name}'. Supported checks: ${Object.keys(checks).join(', ')}.`);
    }
    io.out(checkHelp(name) + '\n');
    return 0;
  }

  if (!checks[command]) {
    return fail(io, `Unknown check '${command}'. Supported checks: ${Object.keys(checks).join(', ')}.`);
  }

  const artifactSource = flags.artifact;
  if (typeof artifactSource !== 'string' || artifactSource.length === 0) {
    return fail(io, "missing required option --artifact <file.json> (use '-' for stdin)");
  }

  let artifact: unknown;
  try {
    artifact = artifactSource === '-'
      ? parseJson(fs.readFileSync(0, 'utf8'), 'stdin')
      : readJson(path.resolve(artifactSource));
  } catch (err: unknown) {
    return fail(io, err instanceof Error ? err.message : String(err));
  }
  if (!isPlainObject(artifact)) {
    return fail(io, 'artifact must be a JSON object');
  }

  let params: Record<string, unknown> = {};
  try {
    if (flags.params !== undefined) {
      if (typeof flags.params !== 'string') {
        return fail(io, '--params expects an inline JSON object string');
      }
      const parsed = parseJson(flags.params, '--params');
      if (!isPlainObject(parsed)) return fail(io, '--params must be a JSON object');
      params = parsed;
    } else if (flags['params-file'] !== undefined) {
      const parsed = readJson(path.resolve(String(flags['params-file'])));
      if (!isPlainObject(parsed)) return fail(io, 'params file must contain a JSON object');
      params = parsed;
    }
  } catch (err: unknown) {
    return fail(io, err instanceof Error ? err.message : String(err));
  }

  let artifacts: Record<string, Record<string, unknown>> = {};
  if (flags.artifacts !== undefined) {
    try {
      if (typeof flags.artifacts !== 'string') {
        return fail(io, '--artifacts expects an inline JSON object of named documents');
      }
      const parsed = parseJson(flags.artifacts, '--artifacts');
      if (!isPlainObject(parsed)) return fail(io, '--artifacts must be a JSON object');
      for (const [name, doc] of Object.entries(parsed)) {
        if (!isPlainObject(doc)) return fail(io, `--artifacts.${name} must be a JSON object`);
      }
      artifacts = parsed as Record<string, Record<string, unknown>>;
    } catch (err: unknown) {
      return fail(io, err instanceof Error ? err.message : String(err));
    }
  }

  const basePath = typeof flags.basePath === 'string' && flags.basePath.length > 0
    ? path.resolve(flags.basePath)
    : undefined;

  let findings: Finding[];
  try {
    findings = runCheck(command, { artifact, params, artifacts, basePath });
  } catch (err: unknown) {
    return fail(io, err instanceof Error ? err.message : String(err));
  }

  io.out(JSON.stringify(findings, null, 2) + '\n');
  return findings.length > 0 ? 1 : 0;
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = runCli(process.argv.slice(2));
}
