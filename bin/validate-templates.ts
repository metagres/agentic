#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../src/scripts/lib/yaml-io.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = path.join(root, 'src', 'templates');

const expectedKeys = {
  'requirements.yaml': [
    'metadata',
    'problem_statement',
    'discovery_log',
    'assumptions',
    'functional_requirements',
    'non_functional_requirements',
    'acceptance_criteria',
    'out_of_scope',
    'failure_paths',
    'risks_and_dependencies',
    'delta',
    'semantic_validation',
  ],

  'design.yaml': [
    'metadata',
    'context_summary',
    'components',
    'data_models',
    'apis',
    'flows',
    'decisions',
    'traceability',
    'delta',
    'semantic_validation',
  ],

  'plan.yaml': [
    'metadata',
    'tasks',
    'milestones',
    'risks',
    'delta',
    'semantic_validation',
  ],
};

const expectedStage = {
  'requirements.yaml': 'requirements',
  'design.yaml': 'design',
  'plan.yaml': 'planning',
};

const results = [];
let failed = false;

for (const [file, keys] of Object.entries(expectedKeys)) {
  const templatePath = path.join(templatesDir, file);

  try {
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Missing template file: ${templatePath}`);
    }

    const doc = readYaml(templatePath) as Record<string, unknown>;

    const missingKeys = keys.filter((key: string) => !(key in doc));

    if (missingKeys.length > 0) {
      throw new Error(`Missing top-level keys: ${missingKeys.join(', ')}`);
    }

    const metadata = doc.metadata as Record<string, unknown> | undefined;
    if (!metadata || typeof metadata !== 'object') {
      throw new Error('metadata must be an object');
    }

    const expected = (expectedStage as Record<string, string>)[file];

    if (metadata.stage !== expected) {
      throw new Error(
        `metadata.stage should be '${expected}', found '${metadata.stage}'`
      );
    }

    results.push({
      file,
      ok: true,
    });
  } catch (err: unknown) {
    failed = true;

    results.push({
      file,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Validate docs index template.
try {
  const indexFile = path.join(templatesDir, 'docs-current-index.md');

  if (!fs.existsSync(indexFile)) {
    throw new Error(`Missing template file: ${indexFile}`);
  }

  const content = fs.readFileSync(indexFile, 'utf8');

  if (!content.includes('| File | Purpose | When to Read | Notes |')) {
    throw new Error('docs-current-index.md is missing the expected table header');
  }

  results.push({
    file: 'docs-current-index.md',
    ok: true,
  });
} catch (err: unknown) {
  failed = true;

  results.push({
    file: 'docs-current-index.md',
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
}

console.log(
  JSON.stringify(
    {
      ok: !failed,
      templates: results,
    },
    null,
    2
  )
);

process.exit(failed ? 1 : 0);
