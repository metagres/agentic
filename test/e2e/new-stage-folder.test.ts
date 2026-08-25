import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const deployScript = path.join(root, 'bin', 'deploy-to-agent.ts');

const FIXTURE_STAGE = {
  'stage.yaml': [
    'version: 1',
    'id: release',
    'kind: authoring',
    'title: Release',
    'artifact: release.yaml',
    'status_field: status',
    'requires: []',
    'next_ids:',
    '  RL: releases',
    'produces_delta: false',
    '',
  ].join('\n'),
  'structural-checks.yaml': 'version: 1\nchecks: []\n',
  'schema.yaml': JSON.stringify(
    {
      type: 'object',
      required: ['metadata', 'releases', 'delta'],
      properties: {
        metadata: { type: 'object' },
        releases: { type: 'array' },
        delta: { type: 'array' },
      },
    }
  ) + '\n',
  'template.yaml': [
    'metadata:',
    '  id: RL-001',
    '  title: "Change title"',
    '  stage: release',
    '  status: draft',
    '  version: 0.1.0',
    '  created: YYYY-MM-DD',
    '  updated: YYYY-MM-DD',
    'releases: []',
    'delta: []',
    '',
  ].join('\n'),
  'steps.yaml': [
    'version: 1',
    'steps:',
    '  needs_input:',
    '    title: Needs input',
    '    markdown: Ask the user which change to release.',
    '    commands:',
    '      - "{{SDLC}} release --change <change-name>"',
    '  init:',
    '    title: Initialization',
    '    markdown: The script created the initial release artifact.',
    '    commands:',
    '      - "{{SDLC}} release --change {{change_name}}"',
    '    complete_when:',
    '      field: metadata.title',
    '      non_empty: true',
    '  drafting:',
    '    title: Drafting',
    '    markdown: Draft the release artifact.',
    '    commands:',
    '      - "{{SDLC}} release --change {{change_name}} --update-artifact < release.yaml"',
    '    complete_when:',
    '      array: releases',
    '      min_items: 1',
    '  validation:',
    '    title: Validation',
    '    markdown: Fix mechanical validation errors first.',
    '    commands:',
    '      - "{{SDLC}} release --change {{change_name}} --finalize"',
    '  delta:',
    '    title: Delta',
    '    markdown: Record living docs deltas or mark the step complete.',
    '    commands:',
    '      - "{{SDLC}} release --change {{change_name}} --complete-step --step delta"',
    '    complete_when:',
    '      any:',
    '        - array: delta',
    '          min_items: 1',
    '        - field: metadata.delta_reviewed',
    '          equals: true',
    '  ready:',
    '    title: Ready',
    '    markdown: All gates passed.',
    '    commands:',
    '      - "{{SDLC}} release --change {{change_name}} --finalize"',
    '  complete:',
    '    title: Complete',
    '    markdown: The release artifact is ready.',
    '    commands:',
    '      - "{{SDLC}} release --change {{change_name}}"',
    '  recovery:',
    '    title: Recovery',
    '    markdown: The artifact was rejected by review.',
    '    commands:',
    '      - "{{SDLC}} release --change {{change_name}} --update-artifact < release.yaml"',
    '',
  ].join('\n'),
  'semantic-checks.yaml': 'version: 1\nchecks: []\n',
};

test('adding a stage folder requires no TypeScript change', { timeout: 240000 }, () => {
  // Deploy the bundle, then drop a fixture stage folder into the bundle's
  // stages directory. The runtime must discover it, list it, and run it from
  // the folder alone — with zero TypeScript edits.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-new-stage-'));
  const dest = path.join(tmp, '.agent');

  const deploy = spawnSync(
    process.execPath,
    [deployScript, '--dest', dest, '--clean', '--skip-smoke'],
    { encoding: 'utf8' }
  );
  assert.equal(deploy.status, 0, deploy.stderr);

  const skillDir = path.join(dest, 'skills', 'agentic-sdlc');
  const stagesDir = path.join(skillDir, 'stages');
  const fixtureDir = path.join(stagesDir, 'release');
  fs.mkdirSync(fixtureDir, { recursive: true });

  for (const [file, content] of Object.entries(FIXTURE_STAGE)) {
    fs.writeFileSync(path.join(fixtureDir, file), content, 'utf8');
  }

  const bundleCli = path.join(skillDir, 'scripts', 'sdlc.js');

  // Discovery: --list-workflows includes the new stage.
  const list = spawnSync(process.execPath, [bundleCli, '--list-workflows'], {
    encoding: 'utf8',
    cwd: dest,
  });
  assert.equal(list.status, 0, list.stderr);
  const listJson = JSON.parse(list.stdout);
  const ids = listJson.data.workflows.map((w) => w.id);
  assert.ok(ids.includes('release'), `expected 'release' in ${ids.join(', ')}`);

  // Authoring run from the folder alone: creates the change and the artifact.
  const project = path.join(tmp, 'project');
  fs.mkdirSync(project, { recursive: true });

  const create = spawnSync(
    process.execPath,
    [bundleCli, 'release', '--cwd', project, '--request', 'Ship the release'],
    { encoding: 'utf8', cwd: dest }
  );
  assert.equal(create.status, 0, create.stderr);
  const createJson = JSON.parse(create.stdout);
  assert.equal(createJson.workflow, 'release');
  assert.ok(createJson.data.change_root, JSON.stringify(createJson));

  const changeRoot = createJson.data.change_root;
  assert.ok(
    fs.existsSync(path.join(changeRoot, 'release.yaml')),
    'release.yaml should be initialized from the stage template'
  );

  // Validation runs from the folder alone: update with a valid artifact.
  const update = spawnSync(
    process.execPath,
    [
      bundleCli,
      'release',
      '--cwd',
      project,
      '--change',
      path.basename(changeRoot),
      '--update-artifact',
    ],
    {
      encoding: 'utf8',
      cwd: dest,
      input: JSON.stringify({
        metadata: { title: 'Ship the release', status: 'draft', version: '0.1.0' },
        releases: [{ id: 'RL-001', name: 'v1.0.0' }],
        delta: [],
      }),
    }
  );
  assert.equal(update.status, 0, update.stderr);
  const updateJson = JSON.parse(update.stdout);
  assert.notEqual(updateJson.state, 'blocked', JSON.stringify(updateJson));
});
