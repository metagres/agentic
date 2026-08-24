import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadStageRegistry,
  getStageById,
  getStageDescriptions,
} from '../../src/scripts/lib/stage-registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function makeStageFixture(stages: Record<string, Record<string, string>>): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-reg-'));
  const stagesDir = path.join(tmp, 'stages');

  for (const [folder, files] of Object.entries(stages)) {
    fs.mkdirSync(path.join(stagesDir, folder), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(stagesDir, folder, file), content, 'utf8');
    }
  }

  return tmp;
}

test('loadStageRegistry discovers stage folders from a fixture stages directory', () => {
  const tmp = makeStageFixture({
    alpha: {
      'stage.yaml': [
        'version: 1',
        'id: alpha',
        'kind: authoring',
        'title: Alpha',
        'artifact: alpha.yaml',
        'status_field: status',
        'produces_delta: true',
        '',
      ].join('\n'),
      'structural-checks.yaml': 'version: 1\nchecks: []\n',
      'schema.yaml': '{ "type": "object" }\n',
      'template.yaml': 'metadata:\n  id: ALPHA-001\n',
      'steps.yaml': 'version: 1\nsteps: {}\n',
      'semantic-checks.yaml': 'version: 1\nchecks: []\n',
    },
    'alpha-review': {
      'stage.yaml': [
        'version: 1',
        'id: alpha-review',
        'kind: review',
        'title: Alpha Review',
        'artifact: alpha.yaml',
        'status_field: status',
        'reviews: alpha',
        'review_file: alpha-review.yaml',
        '',
      ].join('\n'),
      'steps.yaml': 'version: 1\nsteps: {}\n',
    },
  });

  const registry = loadStageRegistry(tmp, path.join(tmp, 'stages'));
  const ids = registry.map((s) => s.id).sort();
  assert.deepEqual(ids, ['alpha', 'alpha-review']);

  const alpha = registry.find((s) => s.id === 'alpha');
  assert.ok(alpha);
  assert.equal(alpha.kind, 'authoring');
  assert.equal(alpha.artifact, 'alpha.yaml');
  assert.equal(alpha.producesDelta, true);
  assert.ok(alpha.files.schema);
  assert.ok(alpha.files.template);
  assert.ok(alpha.files.steps);
  assert.ok(alpha.files.structuralChecks);
  assert.ok(alpha.files.semanticChecks);

  const alphaReview = registry.find((s) => s.id === 'alpha-review');
  assert.ok(alphaReview);
  assert.equal(alphaReview.kind, 'review');
  assert.equal(alphaReview.reviews, 'alpha');
  assert.equal(alphaReview.reviewFile, 'alpha-review.yaml');
  assert.ok(alphaReview.files.steps);
  assert.equal(alphaReview.files.schema, null);
});

test('getStageById returns the record or null', () => {
  const tmp = makeStageFixture({
    alpha: {
      'stage.yaml': [
        'version: 1',
        'id: alpha',
        'kind: authoring',
        'title: Alpha',
        'artifact: alpha.yaml',
        'status_field: status',
        '',
      ].join('\n'),
      'structural-checks.yaml': 'version: 1\nchecks: []\n',
      'schema.yaml': '{ "type": "object" }\n',
      'template.yaml': 'metadata:\n  id: ALPHA-001\n',
      'steps.yaml': 'version: 1\nsteps: {}\n',
      'semantic-checks.yaml': 'version: 1\nchecks: []\n',
    },
  });
  const stagesDir = path.join(tmp, 'stages');

  assert.ok(getStageById(tmp, 'alpha', stagesDir));
  assert.equal(getStageById(tmp, 'does-not-exist', stagesDir), null);
});

test('getStageDescriptions lists discovered stages', () => {
  const tmp = makeStageFixture({
    alpha: {
      'stage.yaml': [
        'version: 1',
        'id: alpha',
        'kind: authoring',
        'title: Alpha',
        'artifact: alpha.yaml',
        'status_field: status',
        '',
      ].join('\n'),
      'structural-checks.yaml': 'version: 1\nchecks: []\n',
      'schema.yaml': '{ "type": "object" }\n',
      'template.yaml': 'metadata:\n  id: ALPHA-001\n',
      'steps.yaml': 'version: 1\nsteps: {}\n',
      'semantic-checks.yaml': 'version: 1\nchecks: []\n',
    },
  });

  const descriptions = getStageDescriptions(tmp, path.join(tmp, 'stages'));
  assert.ok(descriptions.some((d) => d.id === 'alpha'));
});

test('the migrated repository stages are all discovered with the expected kinds', () => {
  const registry = loadStageRegistry(root);
  const byId = new Map(registry.map((s) => [s.id, s]));

  const expected = {
    requirements: 'authoring',
    'requirements-review': 'review',
    design: 'authoring',
    'design-review': 'review',
    planning: 'authoring',
    'planning-review': 'review',
    implementation: 'tasks',
    'implementation-review': 'review',
    'knowledge-extraction': 'aggregator',
  };

  assert.deepEqual(
    Object.fromEntries(registry.map((s) => [s.id, s.kind])),
    expected
  );

  // DM-008 requires edges.
  assert.deepEqual(byId.get('requirements').requires, []);
  assert.equal(byId.get('requirements-review').reviews, 'requirements');
  assert.deepEqual(byId.get('design').requires, ['requirements-review']);
  assert.equal(byId.get('design-review').reviews, 'design');
  assert.deepEqual(byId.get('planning').requires.sort(), ['design-review', 'requirements-review']);
  assert.equal(byId.get('planning-review').reviews, 'planning');
  assert.deepEqual(byId.get('implementation').requires, ['planning-review']);
  assert.equal(byId.get('implementation-review').reviews, 'implementation');
  assert.deepEqual(byId.get('knowledge-extraction').requires, ['implementation-review']);

  // Authoring stages carry the full file set; review stages carry steps only.
  for (const id of ['requirements', 'design', 'planning']) {
    const stage = byId.get(id);
    assert.ok(stage.files.schema, `${id} missing schema.yaml`);
    assert.ok(stage.files.template, `${id} missing template.yaml`);
    assert.ok(stage.files.steps, `${id} missing steps.yaml`);
    assert.ok(stage.files.structuralChecks, `${id} missing structural-checks.yaml`);
    assert.ok(stage.files.semanticChecks, `${id} missing semantic-checks.yaml`);
  }
  for (const id of ['requirements-review', 'design-review', 'planning-review', 'implementation-review']) {
    const stage = byId.get(id);
    assert.ok(stage.files.steps, `${id} missing steps.yaml`);
    assert.equal(stage.files.schema, null);
  }

  // next_ids mapping lives in stage.yaml.
  assert.deepEqual(byId.get('requirements').nextIds, {
    FR: 'functional_requirements',
    NFR: 'non_functional_requirements',
    AC: 'acceptance_criteria',
    DL: 'discovery_log',
  });
});

test('missing stage.yaml is a hard error naming the folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-reg-'));
  const stagesDir = path.join(tmp, 'stages');
  fs.mkdirSync(path.join(stagesDir, 'broken'), { recursive: true });
  fs.writeFileSync(path.join(stagesDir, 'broken', 'placeholder.txt'), '', 'utf8');

  assert.throws(() => loadStageRegistry(tmp, path.join(tmp, 'stages')), /broken.*stage\.yaml/);
});

test('invalid stage.yaml YAML is a hard error naming the folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-reg-'));
  const stagesDir = path.join(tmp, 'stages');
  fs.mkdirSync(path.join(stagesDir, 'bad'), { recursive: true });
  fs.writeFileSync(path.join(stagesDir, 'bad', 'stage.yaml'), 'not: [valid', 'utf8');

  assert.throws(() => loadStageRegistry(tmp, path.join(tmp, 'stages')), /bad/);
});

test('descriptor failing the meta-schema is a hard error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-reg-'));
  const stagesDir = path.join(tmp, 'stages');
  fs.mkdirSync(path.join(stagesDir, 'missing-fields'), { recursive: true });
  fs.writeFileSync(
    path.join(stagesDir, 'missing-fields', 'stage.yaml'),
    'version: 1\nid: missing-fields\nkind: authoring\n',
    'utf8'
  );

  assert.throws(() => loadStageRegistry(tmp, path.join(tmp, 'stages')), /missing-fields/);
});

test('unknown kind value is a hard error naming folder and value', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-reg-'));
  const stagesDir = path.join(tmp, 'stages');
  fs.mkdirSync(path.join(stagesDir, 'weird'), { recursive: true });
  fs.writeFileSync(
    path.join(stagesDir, 'weird', 'stage.yaml'),
    [
      'version: 1',
      'id: weird',
      'kind: wizardry',
      'title: Weird',
      'artifact: weird.yaml',
      'status_field: status',
      '',
    ].join('\n'),
    'utf8'
  );

  assert.throws(() => loadStageRegistry(tmp, path.join(tmp, 'stages')), /weird/);
});

test('folder name not matching descriptor id is a hard error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-reg-'));
  const stagesDir = path.join(tmp, 'stages');
  fs.mkdirSync(path.join(stagesDir, 'renamed'), { recursive: true });
  fs.writeFileSync(
    path.join(stagesDir, 'renamed', 'stage.yaml'),
    [
      'version: 1',
      'id: original',
      'kind: authoring',
      'title: Original',
      'artifact: original.yaml',
      'status_field: status',
      '',
    ].join('\n'),
    'utf8'
  );

  assert.throws(() => loadStageRegistry(tmp, path.join(tmp, 'stages')), /renamed/);
});

test('missing required kind file is a hard error naming the folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-reg-'));
  const stagesDir = path.join(tmp, 'stages');
  fs.mkdirSync(path.join(stagesDir, 'incomplete'), { recursive: true });
  fs.writeFileSync(
    path.join(stagesDir, 'incomplete', 'stage.yaml'),
    [
      'version: 1',
      'id: incomplete',
      'kind: authoring',
      'title: Incomplete',
      'artifact: incomplete.yaml',
      'status_field: status',
      '',
    ].join('\n'),
    'utf8'
  );

  assert.throws(() => loadStageRegistry(tmp, path.join(tmp, 'stages')), /incomplete/);
});
