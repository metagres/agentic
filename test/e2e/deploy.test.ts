import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateWithSchema } from '../../src/scripts/lib/schema.ts';
import { parseYamlString } from '../../src/scripts/lib/yaml-io.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const deployScript = path.join(root, 'bin', 'deploy-to-agent.ts');

test('deploy bundle smoke test', { timeout: 240000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-deploy-smoke-'));
  const dest = path.join(tmp, '.agent');

  // Stale content in both skill folders must be removed by --clean.
  const staleSdlc = path.join(dest, 'skills', 'agentic-sdlc', 'stale.txt');
  const staleKi = path.join(dest, 'skills', 'knowledge-init', 'stale.txt');
  fs.mkdirSync(path.dirname(staleSdlc), { recursive: true });
  fs.mkdirSync(path.dirname(staleKi), { recursive: true });
  fs.writeFileSync(staleSdlc, 'stale', 'utf8');
  fs.writeFileSync(staleKi, 'stale', 'utf8');

  // A stale rendered agent whose source definition no longer exists must be
  // removed by --clean (TASK-010).
  const ghostAgent = path.join(dest, 'agents', 'ghost-agent.md');
  fs.mkdirSync(path.dirname(ghostAgent), { recursive: true });
  fs.writeFileSync(ghostAgent, '---\nname: ghost-agent\n---\n', 'utf8');

  const deploy = spawnSync(
    process.execPath,
    [deployScript, '--dest', dest, '--clean'],
    { encoding: 'utf8' }
  );

  assert.equal(deploy.status, 0, deploy.stderr);
  const deployStdout = deploy.stdout.trim();
  const deployJsonStart = deployStdout.lastIndexOf('\n{');
  const deployJson = JSON.parse(
    deployJsonStart === -1 ? deployStdout : deployStdout.slice(deployJsonStart + 1)
  );
  assert.equal(deployJson.ok, true);

  // --clean removed the stale folders before redeploying.
  assert.ok(!fs.existsSync(staleSdlc), 'stale agentic-sdlc content must be cleaned');
  assert.ok(!fs.existsSync(staleKi), 'stale knowledge-init content must be cleaned');
  assert.ok(!fs.existsSync(ghostAgent), 'stale rendered agent must be cleaned by --clean');

  // The smoke report covers both skills (DEC-010).
  assert.equal(deployJson.smoke, 'passed');
  const skillNames = deployJson.skills.map((s) => s.name).sort();
  assert.deepEqual(skillNames, ['agentic-sdlc', 'knowledge-init']);
  for (const entry of deployJson.skills) {
    assert.equal(entry.smoke, 'passed', JSON.stringify(deployJson.skills));
  }

  // The deploy JSON reports the resolved platform and a per-agent smoke report
  // (TASK-010). Expected agent ids derive from the source agents directory.
  const sourceAgents = fs
    .readdirSync(path.join(root, 'src', 'agents'))
    .filter((entry) => entry.endsWith('.yaml'))
    .map((entry) => path.basename(entry, '.yaml'))
    .sort();
  assert.equal(deployJson.platform, 'opencode');
  assert.equal(typeof deployJson.platformVersion, 'number');
  const agentNames = deployJson.agents.map((a) => a.name).sort();
  assert.deepEqual(agentNames, sourceAgents);
  for (const entry of deployJson.agents) {
    assert.equal(entry.smoke, 'passed', JSON.stringify(deployJson.agents));
  }

  const skillDir = path.join(dest, 'skills', 'agentic-sdlc');

  assert.ok(
    fs.existsSync(path.join(skillDir, 'SKILL.md')),
    'missing generated SKILL.md'
  );
  assert.ok(
    fs.existsSync(path.join(skillDir, 'scripts', 'sdlc.js')),
    'missing bundled CLI'
  );
  assert.ok(
    fs.existsSync(path.join(skillDir, 'manifest.json')),
    'missing deployed manifest'
  );

  const expectedSchemas = [
    'stage.schema.yaml',
    'docs-delta.schema.yaml',
    'cli-envelope.schema.yaml'
  ];

  for (const file of expectedSchemas) {
    assert.ok(
      fs.existsSync(path.join(skillDir, 'schemas', file)),
      `missing deployed schema: ${file}`
    );
  }

  const expectedPolicies = [
    'errors.yaml'
  ];

  for (const file of expectedPolicies) {
    assert.ok(
      fs.existsSync(path.join(skillDir, 'policies', file)),
      `missing deployed policy: ${file}`
    );
  }

  // The templates directory is no longer deployed (DEC-005).
  assert.ok(
    !fs.existsSync(path.join(skillDir, 'templates')),
    'deployed agentic-sdlc skill must not contain a templates directory'
  );

  // Second skill: knowledge-init ships SKILL.md and manifest.json only.
  const knowledgeInitDir = path.join(dest, 'skills', 'knowledge-init');
  assert.ok(
    fs.existsSync(path.join(knowledgeInitDir, 'SKILL.md')),
    'missing deployed knowledge-init SKILL.md'
  );
  assert.ok(
    fs.existsSync(path.join(knowledgeInitDir, 'manifest.json')),
    'missing deployed knowledge-init manifest'
  );

  const knowledgeInitManifest = JSON.parse(
    fs.readFileSync(path.join(knowledgeInitDir, 'manifest.json'), 'utf8')
  );
  assert.equal(knowledgeInitManifest.name, 'knowledge-init');
  assert.ok(knowledgeInitManifest.version, 'manifest must carry a version');
  assert.ok(knowledgeInitManifest.deployedAt, 'manifest must carry deployedAt');
  assert.equal(knowledgeInitManifest.cliPath, undefined, 'knowledge-init ships no CLI');

  // Folder purity: exactly SKILL.md and manifest.json, nothing else.
  const knowledgeInitEntries = fs.readdirSync(knowledgeInitDir).sort();
  assert.deepEqual(knowledgeInitEntries, ['SKILL.md', 'manifest.json']);
  assert.ok(
    !fs.existsSync(path.join(knowledgeInitDir, 'package.json')),
    'deployed knowledge-init skill must not contain package.json'
  );
  assert.ok(
    !fs.existsSync(path.join(knowledgeInitDir, 'node_modules')),
    'deployed knowledge-init skill must not contain node_modules'
  );

  // Every stage folder is bundled (NFR-002), and the bundle contains no
  // source TypeScript files (build-artifact invariant). Expectations derive
  // from the stages directory rather than a hardcoded enumeration.
  const sourceStages = fs
    .readdirSync(path.join(root, 'src', 'stages'))
    .filter((entry) => fs.statSync(path.join(root, 'src', 'stages', entry)).isDirectory());

  for (const stage of sourceStages) {
    assert.ok(
      fs.existsSync(path.join(skillDir, 'stages', stage, 'stage.yaml')),
      `missing deployed stage folder: ${stage}`
    );
  }

  assert.ok(
    !fs.existsSync(path.join(skillDir, 'stages', 'requirements', 'hooks.ts')),
    'stage hooks must be compiled, not bundled as source TypeScript'
  );
  assert.ok(
    fs.existsSync(path.join(skillDir, 'stages', 'requirements', 'hooks.js')),
    'compiled stage hooks.js must be present'
  );
  assert.ok(
    fs.existsSync(
      path.join(skillDir, 'stages', 'requirements', 'requirements-policy.yaml')
    ),
    'the requirements discovery policy must ship in the bundle'
  );

  // No source TypeScript anywhere inside the bundle.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const abs = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(abs) : [abs];
    });
  const allFiles = walk(skillDir);
  assert.ok(
    !allFiles.some((f) => f.endsWith('.ts')),
    'deployed skill must not contain source TypeScript files'
  );

  assert.ok(
    !fs.existsSync(path.join(skillDir, 'package.json')),
    'deployed skill must not contain package.json'
  );
  assert.ok(
    !fs.existsSync(path.join(skillDir, 'node_modules')),
    'deployed skill must not contain node_modules'
  );

  // Agents are rendered into dest/agents/ (TASK-010): exactly one .md per
  // source agent, each with parseable frontmatter, the resolved agent mode,
  // an opencode-go model, and the stage-reviewer file present exactly once.
  const agentsDir = path.join(dest, 'agents');
  assert.ok(fs.existsSync(agentsDir), 'missing deployed agents directory');
  const renderedAgentFiles = fs
    .readdirSync(agentsDir)
    .filter((entry) => entry.endsWith('.md'))
    .sort();
  assert.deepEqual(
    renderedAgentFiles,
    sourceAgents.map((id) => `${id}.md`),
    'rendered agent files must match the source agent roster'
  );

  for (const file of renderedAgentFiles) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');
    const lines = content.split('\n');
    assert.equal(lines[0], '---', `missing frontmatter in ${file}`);
    const closeIdx = lines.indexOf('---', 1);
    assert.ok(closeIdx > 1, `unterminated frontmatter in ${file}`);
    const frontmatter = parseYamlString(
      lines.slice(1, closeIdx).join('\n'),
      file
    ) as Record<string, unknown>;
    // No roster agent pins a mode, so the registry normalizes every record
    // to 'all' and the renderer emits it verbatim.
    assert.equal(frontmatter.mode, 'all', file);
    assert.ok(
      typeof frontmatter.model === 'string' &&
        frontmatter.model.startsWith('opencode-go/'),
      `model must start with opencode-go/ in ${file}`
    );
    // Interactive questioning (TASK-003): only requirements-analyst may ask
    // questions; every other agent is denied.
    const permission = frontmatter.permission as Record<string, string>;
    const expectedQuestion = file === 'requirements-analyst.md' ? 'allow' : 'deny';
    assert.equal(permission.question, expectedQuestion, `${file} question permission`);
  }

  assert.equal(
    renderedAgentFiles.filter((f) => f === 'stage-reviewer.md').length,
    1,
    'stage-reviewer.md must be rendered exactly once'
  );

  // The agents directory is a build artifact: no source TypeScript and no
  // package.json inside it.
  const agentFiles = walk(agentsDir);
  assert.ok(
    !agentFiles.some((f) => f.endsWith('.ts')),
    'deployed agents must not contain source TypeScript files'
  );
  assert.ok(
    !fs.existsSync(path.join(agentsDir, 'package.json')),
    'deployed agents must not contain package.json'
  );

  const cli = spawnSync(
    process.execPath,
    [path.join(skillDir, 'scripts', 'sdlc.js'), '--list-workflows'],
    {
      encoding: 'utf8',
      cwd: dest
    }
  );

  assert.equal(cli.status, 0, cli.stderr);
  const json = JSON.parse(cli.stdout);
  const findings = validateWithSchema(json, 'cli-envelope.schema.yaml', root);
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('deploy --platform-version 1 renders legacy tools and skills stay platform-uniform', { timeout: 240000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-deploy-v1-'));
  const destV1 = path.join(tmp, 'v1');
  const destV2 = path.join(tmp, 'v2');

  const deployV1 = spawnSync(
    process.execPath,
    [deployScript, '--dest', destV1, '--platform-version', '1'],
    { encoding: 'utf8' }
  );
  assert.equal(deployV1.status, 0, deployV1.stderr);
  const v1Stdout = deployV1.stdout.trim();
  const v1JsonStart = v1Stdout.lastIndexOf('\n{');
  const v1Json = JSON.parse(
    v1JsonStart === -1 ? v1Stdout : v1Stdout.slice(v1JsonStart + 1)
  );
  assert.equal(v1Json.platformVersion, 1);

  // The v1 renderer emits the legacy `tools` frontmatter key, not `permission`.
  const stageReviewerV1 = fs.readFileSync(
    path.join(destV1, 'agents', 'stage-reviewer.md'),
    'utf8'
  );
  const v1Lines = stageReviewerV1.split('\n');
  const v1CloseIdx = v1Lines.indexOf('---', 1);
  assert.ok(v1CloseIdx > 1, 'unterminated frontmatter in v1 stage-reviewer.md');
  const v1Frontmatter = parseYamlString(
    v1Lines.slice(1, v1CloseIdx).join('\n'),
    'stage-reviewer.md'
  ) as Record<string, unknown>;
  assert.ok('tools' in v1Frontmatter, 'v1 renderer must emit the legacy tools key');
  assert.ok(
    !('permission' in v1Frontmatter),
    'v1 renderer must not emit the permission key'
  );

  // Skills deploy identically for every platform version (TASK-010): the
  // generated SKILL.md must be byte-identical across versions.
  const deployV2 = spawnSync(
    process.execPath,
    [deployScript, '--dest', destV2, '--platform-version', '2'],
    { encoding: 'utf8' }
  );
  assert.equal(deployV2.status, 0, deployV2.stderr);

  const skillV1 = fs.readFileSync(
    path.join(destV1, 'skills', 'agentic-sdlc', 'SKILL.md'),
    'utf8'
  );
  const skillV2 = fs.readFileSync(
    path.join(destV2, 'skills', 'agentic-sdlc', 'SKILL.md'),
    'utf8'
  );
  assert.equal(skillV1, skillV2, 'SKILL.md must be byte-identical across platform versions');
});

test('deploy with an unknown platform fails listing supported platforms', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-deploy-badplat-'));
  const dest = path.join(tmp, '.agent');

  const deploy = spawnSync(
    process.execPath,
    [deployScript, '--dest', dest, '--platform', 'nosuch'],
    { encoding: 'utf8' }
  );

  assert.notEqual(deploy.status, 0, 'unknown platform must fail the deploy');
  assert.match(deploy.stderr, /Unknown platform 'nosuch'/);
  assert.match(deploy.stderr, /opencode/);
});
