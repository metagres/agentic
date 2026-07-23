#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../src/scripts/lib/yaml-io.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policiesDir = path.join(root, 'src', 'policies');
const contractsDir = path.join(root, 'src', 'contracts');
const schemasDir = path.join(root, 'src', 'schemas');
const templatesDir = path.join(root, 'src', 'templates');

const results = [];
let failed = false;

function check(file, fn) {
  const filePath = path.join(policiesDir, file);
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing policy file: ${filePath}`);
    }
    const doc = readYaml(filePath);
    fn(doc);
    results.push({ file, ok: true });
  } catch (err) {
    failed = true;
    results.push({ file, ok: false, error: err.message });
  }
}

function exists(dir, file) {
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

check('pipeline.yaml', (doc) => {
  if (!doc || typeof doc !== 'object') throw new Error('pipeline.yaml must be an object');
  if (!doc.stages || typeof doc.stages !== 'object') throw new Error('pipeline.yaml must define stages');

  for (const [stageId, stage] of Object.entries(doc.stages)) {
    if (stage.contract && !exists(contractsDir, stage.contract)) {
      throw new Error(`pipeline stage '${stageId}' references missing contract: ${stage.contract}`);
    }
    if (stage.schema && !exists(schemasDir, stage.schema)) {
      throw new Error(`pipeline stage '${stageId}' references missing schema: ${stage.schema}`);
    }
    if (stage.template && !exists(templatesDir, stage.template)) {
      throw new Error(`pipeline stage '${stageId}' references missing template: ${stage.template}`);
    }
    for (const req of stage.requires || []) {
      if (!doc.stages[req]) {
        throw new Error(`pipeline stage '${stageId}' requires unknown stage: ${req}`);
      }
    }
  }
});

check('review-targets.yaml', (doc) => {
  if (!doc || typeof doc !== 'object') throw new Error('review-targets.yaml must be an object');
  if (!doc.targets || typeof doc.targets !== 'object') throw new Error('review-targets.yaml must define targets');

  for (const [targetId, target] of Object.entries(doc.targets)) {
    if (!target.artifact) throw new Error(`review target '${targetId}' missing artifact`);
    if (!target.contract) throw new Error(`review target '${targetId}' missing contract`);
    if (!exists(contractsDir, target.contract)) {
      throw new Error(`review target '${targetId}' references missing contract: ${target.contract}`);
    }
    if (!target.review_file) throw new Error(`review target '${targetId}' missing review_file`);
    if (!['status', 'implementation_status'].includes(target.status_field)) {
      throw new Error(`review target '${targetId}' has invalid status_field`);
    }
  }
});

check('lifecycle.yaml', (doc) => {
  if (!doc || typeof doc !== 'object') throw new Error('lifecycle.yaml must be an object');

  for (const [kind, known] of [
    ['artifact_status', ARTIFACT_STATUSES],
    ['implementation_status', IMPLEMENTATION_STATUSES]
  ]) {
    const machine = doc[kind];
    if (!machine || typeof machine !== 'object') throw new Error(`lifecycle.yaml must define ${kind}`);
    if (!known.has(machine.initial)) throw new Error(`${kind}.initial is invalid: ${machine.initial}`);
    if (!machine.transitions || typeof machine.transitions !== 'object') {
      throw new Error(`${kind}.transitions must be an object`);
    }
    for (const [from, targets] of Object.entries(machine.transitions)) {
      if (!known.has(from)) throw new Error(`${kind} transition from unknown status: ${from}`);
      if (!Array.isArray(targets)) throw new Error(`${kind}.${from} must be an array`);
      for (const to of targets) {
        if (!known.has(to)) throw new Error(`${kind}.${from} targets unknown status: ${to}`);
      }
    }
  }
});

check('requirements-policy.yaml', (doc) => {
  if (!doc?.discovery?.clarity || typeof doc.discovery.clarity !== 'object') {
    throw new Error('requirements-policy.yaml must define discovery.clarity');
  }

  for (const lens of doc?.discovery?.lenses || []) {
    if (!LENSES.has(lens)) throw new Error(`Unknown discovery lens in policy: ${lens}`);
  }

  for (const [clarity, cfg] of Object.entries(doc.discovery.clarity)) {
    for (const lens of cfg.required_lenses || []) {
      if (!LENSES.has(lens)) {
        throw new Error(`requirements-policy clarity '${clarity}' uses unknown lens: ${lens}`);
      }
    }
    if (!(Number(cfg.min_resolved_questions) > 0)) {
      throw new Error(`requirements-policy clarity '${clarity}' min_resolved_questions must be positive`);
    }
  }
});

check('semantic-policy.yaml', (doc) => {
  const min = doc?.semantic_validation?.default_min_evidence_chars;
  if (typeof min !== 'number' || min <= 0) {
    throw new Error(
      'semantic-policy.yaml must define semantic_validation.default_min_evidence_chars as a positive number'
    );
  }

  const allowed = doc?.semantic_validation?.allowed_statuses || [];
  for (const status of allowed) {
    if (!['pass', 'fail', 'waived'].includes(status)) {
      throw new Error(`semantic-policy allowed status is invalid: ${status}`);
    }
  }
});

check('errors.yaml', (doc) => {
  if (!doc.errors || typeof doc.errors !== 'object') throw new Error('errors.yaml must define errors');
  for (const [code, def] of Object.entries(doc.errors)) {
    if (!def || typeof def.message !== 'string') {
      throw new Error(`errors.yaml entry '${code}' must define message`);
    }
  }
});

check('ids.yaml', (doc) => {
  if (!doc.prefixes || typeof doc.prefixes !== 'object') throw new Error('ids.yaml must define prefixes');
  for (const [prefix, def] of Object.entries(doc.prefixes)) {
    if (!def || typeof def.pattern !== 'string') {
      throw new Error(`ids.yaml prefix '${prefix}' must define pattern`);
    }
    new RegExp(def.pattern);
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
