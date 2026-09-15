import type { CheckEntry, CheckImpl, CheckManifest, RunOptions } from './types.ts';
import type { Finding } from './types.ts';
import { formatHelp } from './help.ts';
import * as uniqueIds from './checks/unique-ids.ts';
import * as refExists from './checks/ref-exists.ts';
import * as refCovers from './checks/ref-covers.ts';
import * as duplicateRefs from './checks/duplicate-refs.ts';
import * as givenWhenThen from './checks/given-when-then.ts';
import * as forbiddenWords from './checks/forbidden-words.ts';
import * as requiredNoteForStatus from './checks/required-note-for-status.ts';
import * as allTasksTerminal from './checks/all-tasks-terminal.ts';
import * as dependencyAcyclic from './checks/dependency-acyclic.ts';
import * as dependencyOrder from './checks/dependency-order.ts';

/** The module shape every check file exports. */
export interface CheckModule {
  manifest: CheckManifest;
  check: CheckImpl;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Validates the caller-supplied run options and the manifest's required
// parameters before the check implementation runs. Throws an Error naming the
// check and the problem; unknown and missing-parameter errors are distinct.
function assertRunOptions(manifest: CheckManifest, options: RunOptions): void {
  const label = `Check '${manifest.name}'`;

  if (!options || typeof options !== 'object') {
    throw new Error(`${label} requires run options with an 'artifact' JSON object.`);
  }
  if (!isPlainObject(options.artifact)) {
    throw new Error(`${label} requires options.artifact to be a JSON object.`);
  }
  if (options.params !== undefined && !isPlainObject(options.params)) {
    throw new Error(`${label} requires options.params to be a JSON object when provided.`);
  }
  if (options.artifacts !== undefined) {
    if (!isPlainObject(options.artifacts)) {
      throw new Error(`${label} requires options.artifacts to be an object of JSON documents when provided.`);
    }
    for (const [name, doc] of Object.entries(options.artifacts)) {
      if (!isPlainObject(doc)) {
        throw new Error(`${label} requires options.artifacts.${name} to be a JSON object.`);
      }
    }
  }
  if (options.basePath !== undefined && (typeof options.basePath !== 'string' || options.basePath.length === 0)) {
    throw new Error(`${label} requires options.basePath to be a non-empty string when provided.`);
  }

  const params = options.params ?? {};
  const missing = manifest.params
    .filter((p) => p.required && params[p.name] === undefined)
    .map((p) => p.name);
  if (missing.length > 0) {
    throw new Error(`${label} is missing required parameter(s): ${missing.join(', ')}.`);
  }
}

// Wraps one check module into a registry entry: validates inputs on run and
// exposes the manifest through help().
function define(module: CheckModule): CheckEntry {
  const { manifest, check } = module;

  return Object.freeze({
    manifest: Object.freeze({ ...manifest }),
    run(options: RunOptions): Finding[] {
      assertRunOptions(manifest, options);
      const params = options.params ?? {};
      return check({
        artifact: options.artifact,
        artifacts: options.artifacts ?? {},
        params,
        basePath: options.basePath,
      });
    },
    help(): string {
      return formatHelp(manifest);
    },
  });
}

const modules: CheckModule[] = [
  uniqueIds,
  refExists,
  refCovers,
  duplicateRefs,
  givenWhenThen,
  forbiddenWords,
  requiredNoteForStatus,
  allTasksTerminal,
  dependencyAcyclic,
  dependencyOrder,
];

/**
 * The check registry, keyed by check name. Use it dictionary-style:
 *
 *   checks['unique-ids'].run({ artifact, params })
 *   checks['unique-ids'].help()
 *   checks['unique-ids'].manifest
 */
export const checks: Record<string, CheckEntry> = Object.freeze(
  Object.fromEntries(modules.map((m) => [m.manifest.name, define(m)]))
);

/** The manifests of every supported check, in registry order. */
export function listChecks(): CheckManifest[] {
  return Object.values(checks).map((entry) => entry.manifest);
}

/** Fires one check by name. Unknown names abort with the list of supported checks. */
export function runCheck(name: string, options: RunOptions): Finding[] {
  const entry = checks[name];
  if (!entry) {
    throw new Error(`Unknown check '${String(name)}'. Supported checks: ${Object.keys(checks).join(', ')}.`);
  }
  return entry.run(options);
}

/** The --help text of one check by name. Unknown names abort like runCheck. */
export function checkHelp(name: string): string {
  const entry = checks[name];
  if (!entry) {
    throw new Error(`Unknown check '${String(name)}'. Supported checks: ${Object.keys(checks).join(', ')}.`);
  }
  return entry.help();
}
