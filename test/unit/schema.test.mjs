import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSchema,
  validateWithSchema,
  validateArtifactSchema,
} from '../../src/scripts/lib/schema.mjs';
import {
  validRequirements,
  validDesign,
  validPlan,
  semanticResults,
} from '../helpers/artifacts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

test('all schemas compile', () => {
  const schemaDir = path.join(root, 'src', 'schemas');
  const files = fs.readdirSync(schemaDir).filter((f) => f.endsWith('.yaml'));
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotThrow(() => loadSchema(file, root), `schema failed to compile: ${file}`);
  }
});

test('valid artifacts pass schema validation', () => {
  assert.deepEqual(
    validateArtifactSchema(
      'requirements',
      validRequirements({ semantic: semanticResults(root, 'requirements') }),
      root
    ),
    []
  );

  assert.deepEqual(
    validateArtifactSchema(
      'design',
      validDesign({ semantic: semanticResults(root, 'design') }),
      root
    ),
    []
  );

  assert.deepEqual(
    validateArtifactSchema(
      'plan',
      validPlan({ semantic: semanticResults(root, 'plan') }),
      root
    ),
    []
  );
});

test('unknown top-level field fails schema validation', () => {
  const artifact = validRequirements({ semantic: semanticResults(root, 'requirements') });
  const invalid = { ...artifact, not_allowed: true };
  const findings = validateArtifactSchema('requirements', invalid, root);
  assert.ok(findings.length > 0);
});

test('invalid metadata id fails schema validation', () => {
  const artifact = validRequirements({ semantic: semanticResults(root, 'requirements') });
  const invalid = JSON.parse(JSON.stringify(artifact));
  invalid.metadata.id = 'BAD-ID';
  const findings = validateArtifactSchema('requirements', invalid, root);
  assert.ok(findings.length > 0);
});

test('docs-delta archive shape validates', () => {
  const docsDelta = {
    metadata: {
      stage: 'knowledge-extraction',
      status: 'pending',
      created: '2026-07-23',
      updated: '2026-07-23',
      change_root: '/tmp/change',
      implementation_status: null
    },
    validation_errors: [],
    entries: [
      {
        key: 'requirements|docs/current/overview.md|Add|reason',
        id: 'DD-00000001',
        source_stage: 'requirements',
        source_artifact: 'requirements.yaml',
        phase: 'Requirements',
        target_doc: 'docs/current/overview.md',
        target_anchor: null,
        entity_id: null,
        change: 'Add',
        reason: 'Add overview section.',
        date: '2026-07-23',
        status: 'pending',
        extracted_at: null,
        extraction_note: null
      }
    ],
    archived_entries: [
      {
        id: 'DD-00000002',
        key: 'old-key',
        archived_reason: 'removed_from_source_artifact',
        archived_at: '2026-07-23',
        original_entry: {}
      }
    ]
  };

  assert.deepEqual(validateWithSchema(docsDelta, 'docs-delta.schema.yaml', root), []);
});

test('CLI envelope schema remains strict', () => {
  const valid = {
    workflow: 'cli',
    step: 'help',
    state: 'ok',
    instructions: '',
    data: {},
    errors: [],
    warnings: []
  };
  assert.deepEqual(validateWithSchema(valid, 'cli-envelope.schema.yaml', root), []);

  const invalid = { ...valid, next_action: 'not allowed' };
  assert.ok(validateWithSchema(invalid, 'cli-envelope.schema.yaml', root).length > 0);
});
