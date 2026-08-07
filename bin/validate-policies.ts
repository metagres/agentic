#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../src/scripts/lib/yaml-io.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policiesDir = path.join(root, 'src', 'policies');
const schemasDir = path.join(root, 'src', 'schemas');
const templatesDir = path.join(root, 'src', 'templates');

const results: { file: string; ok: boolean; error?: string }[] = [];
let failed = false;

function check(file: string, fn: (doc: unknown) => void) {
  const filePath = path.join(policiesDir, file);
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing policy file: ${filePath}`);
    }
    const doc = readYaml(filePath);
    fn(doc);
    results.push({ file, ok: true });
  } catch (err: unknown) {
    failed = true;
    results.push({ file, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function exists(dir: string, file: string) {
  return fs.existsSync(path.join(dir, file));
}

const ARTIFACT_STATUSES = new Set([
  'draft',
  'ready-for-review',
  'accepted',
  'rejected',
  'blocked'
]);

const IMPLEMENTATION_STATUSES = new Set([
  'pending',
  'in_progress',
  'ready-for-review',
  'accepted',
  'rejected'
]);

const LENSES = new Set([
  'stakeholder',
  'scope',
  'interface',
  'behavior',
  'design',
  'constraint',
  'failure',
  'outcome'
]);

check('pipeline.yaml', (doc: unknown) => {
  const d = doc as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') throw new Error('pipeline.yaml must be an object');
  const stages = d.stages as Record<string, unknown> | undefined;
  if (!stages || typeof stages !== 'object') throw new Error('pipeline.yaml must define stages');

  for (const [stageId, stage] of Object.entries(stages)) {
    const s = stage as Record<string, unknown>;
    if (s.schema && !exists(schemasDir, s.schema as string)) {
      throw new Error(`pipeline stage '${stageId}' references missing schema: ${s.schema}`);
    }
    if (s.template && !exists(templatesDir, s.template as string)) {
      throw new Error(`pipeline stage '${stageId}' references missing template: ${s.template}`);
    }
    for (const req of (s.requires as string[]) || []) {
      if (!stages[req]) {
        throw new Error(`pipeline stage '${stageId}' requires unknown stage: ${req}`);
      }
    }
  }
});

check('review-targets.yaml', (doc: unknown) => {
  const d = doc as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') throw new Error('review-targets.yaml must be an object');
  const targets = d.targets as Record<string, unknown> | undefined;
  if (!targets || typeof targets !== 'object') throw new Error('review-targets.yaml must define targets');

  for (const [targetId, target] of Object.entries(targets)) {
    const t = target as Record<string, unknown>;
    if (!t.artifact) throw new Error(`review target '${targetId}' missing artifact`);
    if (!t.review_file) throw new Error(`review target '${targetId}' missing review_file`);
    if (!['status', 'implementation_status'].includes(t.status_field as string)) {
      throw new Error(`review target '${targetId}' has invalid status_field`);
    }
  }
});

check('requirements-policy.yaml', (doc: unknown) => {
  const d = doc as Record<string, unknown> | null;
  const discovery = d?.discovery as Record<string, unknown> | undefined;
  if (!discovery?.clarity || typeof discovery.clarity !== 'object') {
    throw new Error('requirements-policy.yaml must define discovery.clarity');
  }

  for (const lens of (discovery.lenses as string[]) || []) {
    if (!LENSES.has(lens)) throw new Error(`Unknown discovery lens in policy: ${lens}`);
  }

  const clarity = discovery.clarity as Record<string, unknown>;
  for (const [clarityName, cfg] of Object.entries(clarity)) {
    const c = cfg as Record<string, unknown>;
    for (const lens of (c.required_lenses as string[]) || []) {
      if (!LENSES.has(lens)) {
        throw new Error(`requirements-policy clarity '${clarityName}' uses unknown lens: ${lens}`);
      }
    }
    if (!(Number(c.min_resolved_questions) > 0)) {
      throw new Error(`requirements-policy clarity '${clarityName}' min_resolved_questions must be positive`);
    }
  }
});

check('errors.yaml', (doc: unknown) => {
  const d = doc as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') throw new Error('errors.yaml must be an object');
  const errors = d.errors as Record<string, unknown> | undefined;
  if (!errors || typeof errors !== 'object') throw new Error('errors.yaml must define errors');
  for (const [code, def] of Object.entries(errors)) {
    const entry = def as Record<string, unknown> | null;
    if (!entry || typeof entry.message !== 'string') {
      throw new Error(`errors.yaml entry '${code}' must define message`);
    }
  }
});

check('ids.yaml', (doc: unknown) => {
  const d = doc as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') throw new Error('ids.yaml must be an object');
  const prefixes = d.prefixes as Record<string, unknown> | undefined;
  if (!prefixes || typeof prefixes !== 'object') throw new Error('ids.yaml must define prefixes');
  for (const [prefix, def] of Object.entries(prefixes)) {
    const entry = def as Record<string, unknown> | null;
    if (!entry || typeof entry.pattern !== 'string') {
      throw new Error(`ids.yaml prefix '${prefix}' must define pattern`);
    }
    new RegExp(entry.pattern);
  }
});

console.log(
  JSON.stringify(
    {
      ok: !failed,
      policies: results,
    },
    null,
    2
  )
);

process.exit(failed ? 1 : 0);