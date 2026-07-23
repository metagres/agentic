#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml } from '../src/scripts/lib/yaml-io.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policiesDir = path.join(root, 'src', 'policies');

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

check('pipeline.yaml', (doc) => {
  if (!doc || typeof doc !== 'object') {
    throw new Error('pipeline.yaml must be an object');
  }
  if (!doc.stages || typeof doc.stages !== 'object') {
    throw new Error('pipeline.yaml must define stages');
  }
});

check('review-targets.yaml', (doc) => {
  if (!doc || typeof doc !== 'object') {
    throw new Error('review-targets.yaml must be an object');
  }
  if (!doc.targets || typeof doc.targets !== 'object') {
    throw new Error('review-targets.yaml must define targets');
  }
});

check('lifecycle.yaml', (doc) => {
  if (!doc || typeof doc !== 'object') {
    throw new Error('lifecycle.yaml must be an object');
  }
  if (!doc.artifact_status || typeof doc.artifact_status !== 'object') {
    throw new Error('lifecycle.yaml must define artifact_status');
  }
  if (!doc.implementation_status || typeof doc.implementation_status !== 'object') {
    throw new Error('lifecycle.yaml must define implementation_status');
  }
});

check('requirements-policy.yaml', (doc) => {
  if (!doc?.discovery?.clarity || typeof doc.discovery.clarity !== 'object') {
    throw new Error('requirements-policy.yaml must define discovery.clarity');
  }
});

check('semantic-policy.yaml', (doc) => {
  const min = doc?.semantic_validation?.default_min_evidence_chars;
  if (typeof min !== 'number' || min <= 0) {
    throw new Error(
      'semantic-policy.yaml must define semantic_validation.default_min_evidence_chars as a positive number'
    );
  }
});

check('errors.yaml', (doc) => {
  if (!doc.errors || typeof doc.errors !== 'object') {
    throw new Error('errors.yaml must define errors');
  }
});

check('ids.yaml', (doc) => {
  if (!doc.prefixes || typeof doc.prefixes !== 'object') {
    throw new Error('ids.yaml must define prefixes');
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
