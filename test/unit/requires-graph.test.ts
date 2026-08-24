import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computePipelineOrder,
  evaluateGate,
} from '../../src/scripts/lib/requires-graph.ts';
import { loadStageRegistry } from '../../src/scripts/lib/stage-registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function makeFixture(
  stages: Record<string, { kind: string; requires?: string[]; reviews?: string }>
): { tmp: string; stagesDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-dag-'));
  const stagesDir = path.join(tmp, 'stages');

  for (const [id, cfg] of Object.entries(stages)) {
    const folder = path.join(stagesDir, id);
    fs.mkdirSync(folder, { recursive: true });

    const lines = [
      'version: 1',
      `id: ${id}`,
      `kind: ${cfg.kind}`,
      `title: ${id}`,
      `artifact: ${id}.yaml`,
      'status_field: status',
    ];
    if (cfg.requires?.length) {
      lines.push(`requires: [${cfg.requires.join(', ')}]`);
    }
    if (cfg.reviews) {
      lines.push(`reviews: ${cfg.reviews}`);
      lines.push(`review_file: ${id}.yaml`);
    }
    lines.push('');
    fs.writeFileSync(path.join(folder, 'stage.yaml'), lines.join('\n'), 'utf8');

    if (cfg.kind === 'authoring') {
      fs.writeFileSync(path.join(folder, 'structural-checks.yaml'), 'version: 1\nchecks: []\n', 'utf8');
      fs.writeFileSync(path.join(folder, 'schema.yaml'), '{ "type": "object" }\n', 'utf8');
      fs.writeFileSync(path.join(folder, 'template.yaml'), 'metadata:\n  id: T-001\n', 'utf8');
      fs.writeFileSync(path.join(folder, 'steps.yaml'), 'version: 1\nsteps: {}\n', 'utf8');
      fs.writeFileSync(path.join(folder, 'semantic-checks.yaml'), 'version: 1\nchecks: []\n', 'utf8');
    } else if (cfg.kind === 'review') {
      fs.writeFileSync(path.join(folder, 'steps.yaml'), 'version: 1\nsteps: {}\n', 'utf8');
    } else if (cfg.kind === 'tasks') {
      fs.writeFileSync(path.join(folder, 'structural-checks.yaml'), 'version: 1\nchecks: []\n', 'utf8');
      fs.writeFileSync(path.join(folder, 'schema.yaml'), '{ "type": "object" }\n', 'utf8');
      fs.writeFileSync(path.join(folder, 'steps.yaml'), 'version: 1\nsteps: {}\n', 'utf8');
      fs.writeFileSync(path.join(folder, 'semantic-checks.yaml'), 'version: 1\nchecks: []\n', 'utf8');
    } else if (cfg.kind === 'aggregator') {
      fs.writeFileSync(path.join(folder, 'steps.yaml'), 'version: 1\nsteps: {}\n', 'utf8');
      fs.writeFileSync(path.join(folder, 'schema.yaml'), '{ "type": "object" }\n', 'utf8');
    }
  }

  return { tmp, stagesDir };
}

test('AC-012: a stage requiring another is ordered after it', () => {
  const { tmp, stagesDir } = makeFixture({
    a: { kind: 'authoring' },
    b: { kind: 'authoring', requires: ['a'] },
  });

  const order = computePipelineOrder(tmp, stagesDir);
  assert.ok(order.indexOf('a') < order.indexOf('b'));
});

test('AC-013: a valid DAG yields a topological order of all stages', () => {
  const { tmp, stagesDir } = makeFixture({
    a: { kind: 'authoring' },
    'a-review': { kind: 'review', reviews: 'a' },
    b: { kind: 'authoring', requires: ['a-review'] },
    'b-review': { kind: 'review', reviews: 'b' },
    c: { kind: 'authoring', requires: ['b-review'] },
  });

  const order = computePipelineOrder(tmp, stagesDir);
  assert.equal(order.length, 5);
  assert.ok(order.indexOf('a') < order.indexOf('b'));
  assert.ok(order.indexOf('b') < order.indexOf('c'));
});

test('alphabetical tie-break makes output deterministic', () => {
  const { tmp, stagesDir } = makeFixture({
    zeta: { kind: 'authoring' },
    alpha: { kind: 'authoring', requires: ['zeta'] },
    mid: { kind: 'authoring', requires: ['zeta'] },
  });

  const order = computePipelineOrder(tmp, stagesDir);
  // zeta has no deps; alpha and mid both depend on zeta and tie alphabetically.
  assert.deepEqual(order, ['zeta', 'alpha', 'mid']);
});

test('a missing requires reference is a hard error naming the stage', () => {
  const { tmp, stagesDir } = makeFixture({
    a: { kind: 'authoring' },
    b: { kind: 'authoring', requires: ['ghost'] },
  });

  assert.throws(() => computePipelineOrder(tmp, stagesDir), /b.*ghost|ghost/);
});

test('a requires cycle is a hard error naming the cycle', () => {
  const { tmp, stagesDir } = makeFixture({
    a: { kind: 'authoring', requires: ['c'] },
    b: { kind: 'authoring', requires: ['a'] },
    c: { kind: 'authoring', requires: ['b'] },
  });

  assert.throws(
    () => computePipelineOrder(tmp, stagesDir),
    /cycle/i
  );
});

function writeArtifact(changeRoot: string, file: string, status: string) {
  fs.mkdirSync(path.join(changeRoot, 'docs', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(changeRoot, file),
    `metadata:\n  status: ${status}\n`,
    'utf8'
  );
}

test('evaluateGate: authoring stage is blocked until the required artifact is accepted', () => {
  const { tmp, stagesDir } = makeFixture({
    a: { kind: 'authoring' },
    'a-review': { kind: 'review', reviews: 'a' },
    b: { kind: 'authoring', requires: ['a-review'] },
  });

  const changeRoot = path.join(tmp, 'change');
  writeArtifact(changeRoot, 'a.yaml', 'draft');

  const registry = loadStageRegistry(tmp, stagesDir);
  const b = registry.find((s) => s.id === 'b') as NonNullable<ReturnType<typeof registry.find>>;

  let gate = evaluateGate(b, changeRoot, tmp, stagesDir);
  assert.equal(gate.satisfied, false);
  assert.equal(gate.unsatisfied.length, 1);
  assert.equal(gate.unsatisfied[0].stage, 'a-review');
  assert.equal(gate.unsatisfied[0].artifact, 'a.yaml');
  assert.equal(gate.unsatisfied[0].status, 'draft');

  // Tracked artifact of a review stage is the artifact of the stage it reviews.
  writeArtifact(changeRoot, 'a.yaml', 'accepted');
  gate = evaluateGate(b, changeRoot, tmp, stagesDir);
  assert.equal(gate.satisfied, true);
  assert.deepEqual(gate.unsatisfied, []);
});

test('evaluateGate: a review stage is runnable when the tracked artifact is ready-for-review or accepted', () => {
  const { tmp, stagesDir } = makeFixture({
    a: { kind: 'authoring' },
    'a-review': { kind: 'review', reviews: 'a' },
  });

  const changeRoot = path.join(tmp, 'change');
  const registry = loadStageRegistry(tmp, stagesDir);
  const review = registry.find((s) => s.id === 'a-review') as NonNullable<ReturnType<typeof registry.find>>;

  writeArtifact(changeRoot, 'a.yaml', 'draft');
  let gate = evaluateGate(review, changeRoot, tmp, stagesDir);
  assert.equal(gate.satisfied, false);
  assert.equal(gate.unsatisfied[0].required, 'ready-for-review or accepted');

  writeArtifact(changeRoot, 'a.yaml', 'ready-for-review');
  gate = evaluateGate(review, changeRoot, tmp, stagesDir);
  assert.equal(gate.satisfied, true);

  writeArtifact(changeRoot, 'a.yaml', 'accepted');
  gate = evaluateGate(review, changeRoot, tmp, stagesDir);
  assert.equal(gate.satisfied, true);
});

test('evaluateGate: missing tracked artifact is reported as missing status', () => {
  const { tmp, stagesDir } = makeFixture({
    a: { kind: 'authoring' },
    'a-review': { kind: 'review', reviews: 'a' },
    b: { kind: 'authoring', requires: ['a-review'] },
  });

  const changeRoot = path.join(tmp, 'change');
  fs.mkdirSync(changeRoot, { recursive: true });

  const registry = loadStageRegistry(tmp, stagesDir);
  const b = registry.find((s) => s.id === 'b') as NonNullable<ReturnType<typeof registry.find>>;

  const gate = evaluateGate(b, changeRoot, tmp, stagesDir);
  assert.equal(gate.satisfied, false);
  assert.equal(gate.unsatisfied[0].status, 'missing');
});

test('the migrated repository stages form a valid acyclic DAG', () => {
  const order = computePipelineOrder(root);
  assert.equal(order.length, 9);
  assert.ok(order.indexOf('requirements-review') < order.indexOf('design'));
  assert.ok(order.indexOf('requirements-review') < order.indexOf('planning'));
  assert.ok(order.indexOf('design-review') < order.indexOf('planning'));
  assert.ok(order.indexOf('planning-review') < order.indexOf('implementation'));
  assert.ok(order.indexOf('implementation-review') < order.indexOf('knowledge-extraction'));
});

test('the nine-stage topology forms a valid acyclic DAG with deterministic order', () => {
  const { tmp, stagesDir } = makeFixture({
    requirements: { kind: 'authoring' },
    'requirements-review': { kind: 'review', reviews: 'requirements' },
    design: { kind: 'authoring', requires: ['requirements-review'] },
    'design-review': { kind: 'review', reviews: 'design' },
    planning: { kind: 'authoring', requires: ['requirements-review', 'design-review'] },
    'planning-review': { kind: 'review', reviews: 'planning' },
    implementation: { kind: 'authoring', requires: ['planning-review'] },
    'implementation-review': { kind: 'review', reviews: 'implementation' },
    'knowledge-extraction': { kind: 'aggregator', requires: ['implementation-review'] },
  });

  const order = computePipelineOrder(tmp, stagesDir);
  assert.equal(order.length, 9);
  // Guaranteed edges from the requires fields (DM-008): review stages carry no
  // requires edges, so only these orderings are DAG-guaranteed.
  assert.ok(order.indexOf('requirements-review') < order.indexOf('design'));
  assert.ok(order.indexOf('requirements-review') < order.indexOf('planning'));
  assert.ok(order.indexOf('design-review') < order.indexOf('planning'));
  assert.ok(order.indexOf('planning-review') < order.indexOf('implementation'));
  assert.ok(order.indexOf('implementation-review') < order.indexOf('knowledge-extraction'));
});
