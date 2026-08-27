import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { listWorkflows } from '../../src/scripts/workflows/index.ts';
import { loadStageRegistry, getStageById } from '../../src/scripts/lib/stage-registry.ts';
import { loadAgentRegistry, getAgentModelFields } from '../../src/scripts/lib/agent-registry.ts';
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

test('bound workflow entries surface both the recommended and the effective model', () => {
  const workflows = listWorkflows();
  const agents = loadAgentRegistry(root);
  const byId = new Map(agents.map((a) => [a.id, a]));

  for (const entry of workflows) {
    if (!entry.agent) {
      // Unbound entries carry no model fields at all.
      assert.ok(!('model' in entry), `unbound entry '${entry.id}' must not carry model`);
      assert.ok(
        !('effectiveModel' in entry),
        `unbound entry '${entry.id}' must not carry effectiveModel`
      );
      continue;
    }

    const agent = byId.get(entry.agent);
    assert.ok(agent, `entry '${entry.id}' bound to unknown agent '${entry.agent}'`);
    assert.equal(entry.model, agent.model, `recommended model for '${entry.id}'`);
    assert.equal(entry.effectiveModel, agent.effectiveModel, `effective model for '${entry.id}'`);
  }

  // The shipped roster currently pins no override, so recommendation and
  // effective model coincide for every bound stage.
  const requirements = workflows.find((w) => w.id === 'requirements');
  const analyst = byId.get('requirements-analyst');
  assert.ok(requirements && analyst);
  assert.equal(requirements.model, analyst.model);
  assert.equal(requirements.effectiveModel, analyst.effectiveModel);
});

test('cross-cutting workflow entries (status, feedback, doctor) carry agent: null', () => {
  const workflows = listWorkflows();
  for (const id of CROSS_CUTTING_IDS) {
    const entry = workflows.find((w) => w.id === id);
    assert.ok(entry, `missing cross-cutting entry '${id}'`);
    assert.equal(entry.agent, null, `cross-cutting entry '${id}' must be agent-null`);
    assert.ok(!('model' in entry), `cross-cutting entry '${id}' must not carry model`);
    assert.ok(
      !('effectiveModel' in entry),
      `cross-cutting entry '${id}' must not carry effectiveModel`
    );
    assert.ok(entry.description, `cross-cutting entry '${id}' missing description`);
  }
});

test('getAgentModelFields resolves the override as effectiveModel from a fixture roster', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-model-fields-'));
  const agentsDir = path.join(tmp, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });

  const base = (id: string, extra: string[] = []) =>
    [
      'version: 1',
      `id: ${id}`,
      'description: Fixture agent',
      'model: opencode-go/kimi-k3',
      ...extra,
      'temperature: 0.2',
      'permissions:',
      '  file_read: allow',
      '  search: allow',
      '  file_write: deny',
      '  shell: deny',
      '  subagent: deny',
      '  web: deny',
      '  question: deny',
      'system_prompt: You are a neutral agent.',
      '',
    ].join('\n');

  fs.writeFileSync(path.join(agentsDir, 'overriding.yaml'), base('overriding', ["model_override: 'my-provider/my-model'"]), 'utf8');
  fs.writeFileSync(path.join(agentsDir, 'plain.yaml'), base('plain'), 'utf8');

  // An override surfaces as effectiveModel while the recommendation stays.
  assert.deepEqual(getAgentModelFields(tmp, 'overriding', agentsDir), {
    model: 'opencode-go/kimi-k3',
    effectiveModel: 'my-provider/my-model',
  });

  // Without an override the effective model equals the recommendation.
  assert.deepEqual(getAgentModelFields(tmp, 'plain', agentsDir), {
    model: 'opencode-go/kimi-k3',
    effectiveModel: 'opencode-go/kimi-k3',
  });

  // No binding or an unresolved id yields no model fields.
  assert.deepEqual(getAgentModelFields(tmp, null, agentsDir), {});
  assert.deepEqual(getAgentModelFields(tmp, 'does-not-exist', agentsDir), {});
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

    if (entry.agent) {
      // Bound pipeline entries surface the recommended/effective model pair.
      assert.equal(typeof entry.model, 'string', `pipeline '${id}' missing model`);
      assert.equal(
        typeof entry.effectiveModel,
        'string',
        `pipeline '${id}' missing effectiveModel`
      );
    } else {
      assert.ok(!('model' in entry), `unbound pipeline '${id}' must not carry model`);
      assert.ok(
        !('effectiveModel' in entry),
        `unbound pipeline '${id}' must not carry effectiveModel`
      );
    }
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
