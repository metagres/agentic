import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getStage,
  getReviewTargets,
  getReviewTarget,
  getPipelineOrder,
  getStagesWithDelta,
  getSchemaForTarget,
  getArtifactForStage,
} from '../../src/scripts/lib/pipeline.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

test('getStage returns the correct stage config for a known stage id', () => {
  const stage = getStage(root, 'requirements');
  assert.ok(stage);
  assert.equal(stage.artifact, 'requirements.yaml');
  assert.equal(stage.schema, 'requirements.schema.yaml');
  assert.equal(stage.review_file, 'requirements-review.yaml');
  assert.equal(stage.status_field, 'status');
});

test('getStage returns null for an unknown stage id', () => {
  assert.equal(getStage(root, 'does-not-exist'), null);
});

test('getReviewTargets returns all 4 targets', () => {
  const targets = getReviewTargets(root);
  assert.deepEqual(Object.keys(targets).sort(), ['design', 'implementation', 'plan', 'requirements']);
});

test('getReviewTargets for "plan" returns the planning stage review_file and status_field', () => {
  const target = getReviewTarget(root, 'plan');
  assert.ok(target);
  assert.equal(target.artifact, 'plan.yaml');
  assert.equal(target.review_file, 'plan-review.yaml');
  assert.equal(target.status_field, 'status');
});

test('getPipelineOrder returns stages in the correct order', () => {
  assert.deepEqual(getPipelineOrder(root), [
    'requirements',
    'design',
    'planning',
    'implementation',
    'knowledge-extraction',
  ]);
});

test('getStagesWithDelta returns only stages with produces_delta true', () => {
  const stages = getStagesWithDelta(root);
  assert.deepEqual(stages, [
    { stage: 'requirements', artifact: 'requirements.yaml', file: 'requirements.yaml' },
    { stage: 'design', artifact: 'design.yaml', file: 'design.yaml' },
    { stage: 'planning', artifact: 'plan.yaml', file: 'plan.yaml' },
  ]);
});

test('getSchemaForTarget returns the correct schema file for each target', () => {
  assert.equal(getSchemaForTarget(root, 'requirements'), 'requirements.schema.yaml');
  assert.equal(getSchemaForTarget(root, 'design'), 'design.schema.yaml');
  assert.equal(getSchemaForTarget(root, 'plan'), 'plan.schema.yaml');
  assert.equal(getSchemaForTarget(root, 'planning'), 'plan.schema.yaml');
  assert.equal(getSchemaForTarget(root, 'implementation'), 'plan.schema.yaml');
  assert.equal(getSchemaForTarget(root, 'unknown'), null);
});

test('getArtifactForStage returns the artifact file for a stage id', () => {
  assert.equal(getArtifactForStage(root, 'requirements'), 'requirements.yaml');
  assert.equal(getArtifactForStage(root, 'planning'), 'plan.yaml');
  assert.equal(getArtifactForStage(root, 'implementation'), 'plan.yaml');
  assert.equal(getArtifactForStage(root, 'knowledge-extraction'), null);
});