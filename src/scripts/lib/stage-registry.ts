import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveStagesDir } from './paths.ts';
import { readYaml } from './yaml-io.ts';
import { validateWithSchema } from './schema.ts';
import type { WarningItem } from './types.ts';

export type StageKind = 'authoring' | 'review' | 'tasks' | 'aggregator';

/**
 * Runtime registry entry (DM-004): the parsed descriptor, the absolute folder
 * path, resolved paths for each configuration file the kind reads, and the
 * kind value used to dispatch to an interpreter.
 */
export interface StageRecord {
  id: string;
  folder: string;
  kind: StageKind;
  title: string;
  artifact: string;
  statusField: string;
  requires: string[];
  reviews: string | null;
  reviewFile: string | null;
  nextIds: Record<string, string>;
  producesDelta: boolean;
  deltaPhase: string | null;
  titlePrefix: string;
  titleDefault: string;
  agent: string | null;
  permissionOverrides: Record<string, string>;
  files: {
    structuralChecks: string | null;
    schema: string | null;
    template: string | null;
    steps: string | null;
    semanticChecks: string | null;
  };
  hasHooks: boolean;
}

/**
 * Canonical per-kind file sets (CMP-009): authoring stages carry the full set;
 * review stages carry stage.yaml and steps.yaml; tasks stages carry structural
 * checks, schema, steps, and semantic checks; aggregator stages carry steps and
 * schema.
 */
const KIND_FILE_SETS: Record<StageKind, string[]> = {
  authoring: [
    'structural-checks.yaml',
    'schema.yaml',
    'template.yaml',
    'steps.yaml',
    'semantic-checks.yaml',
  ],
  review: ['steps.yaml'],
  tasks: ['structural-checks.yaml', 'schema.yaml', 'steps.yaml', 'semantic-checks.yaml'],
  aggregator: ['steps.yaml', 'schema.yaml'],
};

function isStageKind(value: unknown): value is StageKind {
  return (
    typeof value === 'string' &&
    (value === 'authoring' || value === 'review' || value === 'tasks' || value === 'aggregator')
  );
}

function resolveStageFiles(folder: string, kind: StageKind): StageRecord['files'] {
  const files: StageRecord['files'] = {
    structuralChecks: null,
    schema: null,
    template: null,
    steps: null,
    semanticChecks: null,
  };

  const keyByFile: Record<string, keyof StageRecord['files']> = {
    'structural-checks.yaml': 'structuralChecks',
    'schema.yaml': 'schema',
    'template.yaml': 'template',
    'steps.yaml': 'steps',
    'semantic-checks.yaml': 'semanticChecks',
  };

  for (const file of KIND_FILE_SETS[kind]) {
    const abs = path.join(folder, file);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `Stage folder '${path.basename(folder)}' (kind ${kind}) is missing required file: ${file}`
      );
    }
    files[keyByFile[file]] = abs;
  }

  return files;
}

function loadStageFolder(folder: string, cwd: string): StageRecord {
  const id = path.basename(folder);
  const descriptorPath = path.join(folder, 'stage.yaml');

  if (!fs.existsSync(descriptorPath)) {
    throw new Error(`Stage folder '${id}' is missing its stage.yaml descriptor.`);
  }

  let descriptor: Record<string, unknown>;
  try {
    descriptor = readYaml(descriptorPath) as Record<string, unknown>;
  } catch (err: unknown) {
    throw new Error(
      `Stage folder '${id}' has an invalid stage.yaml: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error(`Stage folder '${id}' has an invalid stage.yaml descriptor.`);
  }

  const schemaFindings = validateWithSchema(descriptor, 'stage.schema.yaml', cwd);
  if (schemaFindings.length > 0) {
    throw new Error(
      `Stage folder '${id}' has an invalid stage.yaml descriptor: ${schemaFindings
        .map((f) => f.finding)
        .join('; ')}`
    );
  }

  const descriptorId = descriptor.id as string;
  if (descriptorId !== id) {
    throw new Error(
      `Stage folder '${id}' does not match its descriptor id '${descriptorId}'.`
    );
  }

  const kind = descriptor.kind as unknown;
  if (!isStageKind(kind)) {
    throw new Error(
      `Stage folder '${id}' declares unknown kind '${String(kind)}'.`
    );
  }

  return {
    id,
    folder,
    kind,
    title: String(descriptor.title || id),
    artifact: String(descriptor.artifact || ''),
    statusField: String(descriptor.status_field || 'status'),
    requires: Array.isArray(descriptor.requires)
      ? (descriptor.requires as string[]).map(String)
      : [],
    reviews: descriptor.reviews ? String(descriptor.reviews) : null,
    reviewFile: descriptor.review_file ? String(descriptor.review_file) : null,
    nextIds: (descriptor.next_ids as Record<string, string>) || {},
    producesDelta: Boolean(descriptor.produces_delta),
    deltaPhase: descriptor.delta_phase ? String(descriptor.delta_phase) : null,
    titlePrefix: descriptor.title_prefix ? String(descriptor.title_prefix) : '',
    titleDefault: descriptor.title_default
      ? String(descriptor.title_default)
      : 'Untitled change',
    agent: descriptor.agent ? String(descriptor.agent) : null,
    permissionOverrides: (descriptor.permissions as Record<string, string>) || {},
    files: resolveStageFiles(folder, kind),
    hasHooks: fs.existsSync(path.join(folder, 'hooks.ts')) ||
      fs.existsSync(path.join(folder, 'hooks.js')),
  };
}

const registryCache = new Map<string, StageRecord[]>();

/**
 * API-001 loadStageRegistry(cwd): scans the stages directory, parses and
 * validates stage.yaml descriptors, builds StageRecords, and returns the cached
 * registry. Throws startup errors naming the offending folder for malformed
 * descriptors and unknown kinds. An explicit stagesDir may be supplied for
 * tests that exercise fixture stage directories.
 */
export function loadStageRegistry(
  cwd: string = process.cwd(),
  stagesDir?: string
): StageRecord[] {
  const resolvedDir = stagesDir || resolveStagesDir(cwd);
  if (!resolvedDir) {
    throw new Error('Stages directory not found. Deploy or restore the runtime stages.');
  }

  if (registryCache.has(resolvedDir)) {
    return registryCache.get(resolvedDir) as StageRecord[];
  }

  const folders = fs
    .readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const registry = folders.map((name) =>
    loadStageFolder(path.join(resolvedDir, name), cwd)
  );
  registryCache.set(resolvedDir, registry);
  return registry;
}

export function getStageById(
  cwd: string,
  stageId: string,
  stagesDir?: string
): StageRecord | null {
  const registry = loadStageRegistry(cwd, stagesDir);
  return registry.find((stage) => stage.id === stageId) || null;
}

export function getStageDescriptions(
  cwd: string,
  stagesDir?: string
): { id: string; description: string; agent: string | null }[] {
  const registry = loadStageRegistry(cwd, stagesDir);
  return registry.map((stage) => ({
    id: stage.id,
    description: stage.title,
    agent: stage.agent,
  }));
}

/**
 * Loads an optional hooks module from the stage folder. The hooks module is the
 * only stage-specific code allowed (DEC-016) and never participates in
 * validation. In the repository the module is hooks.ts; in the deployed bundle
 * it is compiled to hooks.js, so both are attempted.
 */
export async function loadStageHooks(
  stage: StageRecord
): Promise<Record<string, unknown> | null> {
  if (!stage.hasHooks) return null;

  const candidates = [
    path.join(stage.folder, 'hooks.js'),
    path.join(stage.folder, 'hooks.ts'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const mod = await import(pathToFileURL(candidate).href);
      return (mod?.default as Record<string, unknown>) || mod || null;
    } catch {
      return null;
    }
  }

  return null;
}

export async function stagePreconditionWarnings(
  stage: StageRecord,
  env: Record<string, unknown>
): Promise<WarningItem[]> {
  const hooks = await loadStageHooks(stage);
  if (hooks && typeof (hooks as Record<string, unknown>).preconditionWarnings === 'function') {
    const result = (
      hooks as Record<string, unknown>
    ).preconditionWarnings as (e: Record<string, unknown>) => unknown;
    const warnings = result(env);
    return Array.isArray(warnings) ? (warnings as WarningItem[]) : [];
  }
  return [];
}
