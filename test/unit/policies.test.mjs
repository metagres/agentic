import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPipeline,
  loadReviewTargets,
  loadLifecycle,
  loadRequirementsPolicy,
  loadSemanticPolicy,
} from '../../src/scripts/lib/policy-loader.mjs';
import { assertTransition } from '../../src/scripts/lib/lifecycle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

test('pipeline policy loads', () => {
  const pipeline = loadPipeline(root);
  assert.ok(pipeline.stages);
  assert.ok(pipeline.stages.requirements);
  assert.ok(pipeline.stages.design);
  assert.ok(pipeline.stages.planning);
  assert.ok(pipeline.stages.implementation);
  assert.ok(pipeline.stages['knowledge-extraction']);
});

test('review targets policy loads', () => {
  const targets = loadReviewTargets(root);
  assert.ok(targets.targets.requirements);
  assert.ok(targets.targets.design);
  assert.ok(targets.targets.plan);
  assert.ok(targets.targets.implementation);
});

test('lifecycle policy loads and enforces transitions', () => {
  const lifecycle = loadLifecycle(root);

  assert.doesNotThrow(() =>
    assertTransition(lifecycle, 'artifact_status', 'ready-for-review', 'accepted')
  );

  assert.throws(() =>
    assertTransition(lifecycle, 'artifact_status', 'draft', 'accepted')
  );
});

test('requirements policy loads', () => {
  const policy = loadRequirementsPolicy(root);
  assert.ok(policy.discovery.clarity.clear);
  assert.ok(policy.discovery.clarity.partial);
  assert.ok(policy.discovery.clarity.vague);
});

test('semantic policy loads', () => {
  const policy = loadSemanticPolicy(root);
  assert.equal(
    policy.semantic_validation.default_min_evidence_chars,
    20
  );
});
