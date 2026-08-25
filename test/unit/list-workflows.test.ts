import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { listWorkflows } from '../../src/scripts/workflows/index.ts';
import { loadStageRegistry, getStageById } from '../../src/scripts/lib/stage-registry.ts';
import { validateWithSchema } from '../../src/scripts/lib/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.resolve(root, 'src', 'scripts', 'sdlc.ts');

const CROSS_CUTTING_IDS = ['status', 'feedback', 'doctor'];

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  });
}

test('listWorkflows() carries the bound agent id for every discovered stage', () => {
  const workflows = listWorkflows();
  const byId = new Map(workflows.map((w) => [w.id, w]));

  // Expectations derive from the stage registry itself, not a hardcoded list.
  const registry = loadStageRegistry(root);
  for (const stage of registry) {
    const entry = byId.get(stage.id);
    assert.ok(entry, `missing workflow entry for stage '${stage.id}'`);
    assert.equal(entry.agent, stage.agent, `agent mismatch for stage '${stage.id}'`);
    assert.equal(entry.description, stage.title);
  }

  // The shipped bindings (TASK-006) are pinned explicitly so a regression in
  // the descriptors surfaces here even if the registry comparison passes.
  const expected: Record<string, string | null> = {
    requirements: 'requirements-analyst',
    design: 'systems-architect',
    planning: 'task-planner',
    implementation: 'implementation-engineer',
    'requirements-review': 'stage-reviewer',
    'design-review': 'stage-reviewer',
    'planning-review': 'stage-reviewer',
    'implementation-review': 'stage-reviewer',
    'knowledge-extraction': 'knowledge-curator',
  };
  for (const [id, agent] of Object.entries(expected)) {
    assert.equal(byId.get(id)?.agent, agent, `unexpected agent for '${id}'`);
  }
});

test('cross-cutting workflow entries (status, feedback, doctor) carry agent: null', () => {
  const workflows = listWorkflows();
  for (const id of CROSS_CUTTING_IDS) {
    const entry = workflows.find((w) => w.id === id);
    assert.ok(entry, `missing cross-cutting entry '${id}'`);
    assert.equal(entry.agent, null, `cross-cutting entry '${id}' must be agent-null`);
    assert.ok(entry.description, `cross-cutting entry '${id}' missing description`);
  }
});

test('every workflows[] entry carries an agent field and the envelope validates', () => {
  const res = runCli(['--list-workflows']);
  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);
  assert.equal(json.workflow, 'cli');
  assert.equal(json.state, 'ok');

  for (const entry of json.data.workflows) {
    assert.ok('agent' in entry, `workflow entry '${entry.id}' missing agent field`);
  }

  const findings = validateWithSchema(json, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('status pipeline stage entries carry the bound agent id or null', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-list-workflows-'));

  // Create a change so the status workflow has a pipeline to report.
  const req = runCli(['requirements', '--cwd', tmp, '--request', 'Add login']);
  assert.equal(req.status, 0, req.stderr);
  const reqJson = JSON.parse(req.stdout);
  const changeDir = path.basename(reqJson.data.change_root);

  const res = runCli(['status', '--cwd', tmp, '--change', changeDir]);
  assert.equal(res.status, 0, res.stderr);
  const json = JSON.parse(res.stdout);
  assert.equal(json.workflow, 'status');

  // Every stage entry in the pipeline carries status and the bound agent.
  const byId = new Map(loadStageRegistry(root).map((s) => [s.id, s]));
  for (const [id, entry] of Object.entries(json.data.pipeline)) {
    const stage = byId.get(id);
    assert.equal(typeof entry.status, 'string', `pipeline '${id}' missing status`);
    assert.equal(entry.agent, stage ? stage.agent : null, `pipeline '${id}' agent mismatch`);
  }

  // Spot checks: an authoring stage binds its analyst, a review stage binds
  // the shared reviewer, and status still reports the artifact status.
  assert.equal(json.data.pipeline.requirements.agent, 'requirements-analyst');
  assert.equal(json.data.pipeline['requirements-review'].agent, 'stage-reviewer');
  assert.equal(json.data.pipeline.requirements.status, 'draft');

  // The emitted envelope still validates against the frozen schema.
  const findings = validateWithSchema(json, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});
