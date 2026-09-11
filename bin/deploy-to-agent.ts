#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { VERSION } from '../src/scripts/lib/version.ts';
import { parseYamlString } from '../src/scripts/lib/yaml-io.ts';
import { loadAgentRegistry } from '../src/scripts/lib/agent-registry.ts';
import type { AgentRecord } from '../src/scripts/lib/agent-registry.ts';
import {
  getRenderer,
  type AgentRenderer,
  type RenderedAgent,
} from '../src/scripts/lib/deploy/platforms/index.ts';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv: string[]): Record<string, string | boolean | string[]> {
  const args: Record<string, string | boolean | string[]> = { _: [] as string[] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        const idx = arg.indexOf('=');
        const key = arg.slice(2, idx);
        const value = arg.slice(idx + 1);
        args[key] = value;
        continue;
      }

      const key = arg.slice(2);
      const next = argv[i + 1];

      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      (args._ as string[]).push(arg);
    }
  }

  return args;
}

function fail(message: string): never {
  console.error(`[deploy-to-agent] ${message}`);
  process.exit(1);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function rmrf(target: string) {
  fs.rmSync(target, { recursive: true, force: true });
}

// Serializes the tsup build across concurrent deploy invocations (the e2e
// deploy and new-stage-folder tests run in parallel processes). tsup uses
// clean:true, so two concurrent builds would race on dist/.
function runBuild() {
  const lock = path.join(root, '.deploy-build.lock');
  const deadline = Date.now() + 180000;

  while (fs.existsSync(lock)) {
    if (Date.now() > deadline) {
      fail('Timed out waiting for a concurrent build to finish.');
    }
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);
  }

  fs.writeFileSync(lock, String(process.pid));

  try {
    const result = spawnSync('npm', ['run', 'build'], {
      cwd: root,
      encoding: 'utf8',
      shell: true,
    });

    if (result.status !== 0) {
      if (result.stdout) process.stderr.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      fail('Runtime build failed.');
    }
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

function copyDir(src: string, dest: string) {
  if (!fs.existsSync(src)) {
    fail(`Missing source directory: ${src}`);
  }

  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true });
}

/**
 * Compiles any stage hooks modules (.ts) to JavaScript so the bundle contains
 * no source TypeScript files. Hooks modules are bundled self-contained (their
 * only imports are node builtins) and written as <stage>/hooks.js.
 */
function compileStageHooks(stagesDir: string): string[] {
  const compiled: string[] = [];

  if (!fs.existsSync(stagesDir)) return compiled;

  for (const stageName of fs.readdirSync(stagesDir)) {
    const folder = path.join(stagesDir, stageName);
    if (!fs.statSync(folder).isDirectory()) continue;

    const hooksTs = path.join(folder, 'hooks.ts');
    if (!fs.existsSync(hooksTs)) continue;

    const hooksJs = path.join(folder, 'hooks.js');
    // esbuild is a devDependency (via tsup); compile the single hooks module
    // into a self-contained JavaScript file.
    const result = buildSync({
      entryPoints: [hooksTs],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: hooksJs,
      logLevel: 'silent',
    });

    if (result.errors.length > 0) {
      fail(
        `Failed to compile hooks for stage '${stageName}': ${result.errors
          .map((e) => e.text)
          .join('; ')}`
      );
    }

    fs.rmSync(hooksTs, { force: true });
    compiled.push(hooksJs);
  }

  return compiled;
}

// The managed skill rosters: skill id equals the folder name under
// src/skills/ and the frontmatter name in its SKILL.md (enforced by
// bin/validate-templates.ts), and equals the deployed folder name (enforced
// by the per-skill smoke below).
const AGENTIC_SDLC_SKILL_ID = 'agentic-sdlc';
const KNOWLEDGE_INIT_SKILL_ID = 'knowledge-init';

// Stable marker phrase (CMP-005, AC-007): the deploy smoke fails when the
// generated SKILL.md lacks it, so rewording the delegation rule must update
// this constant deliberately (DEC-006).
const DELEGATION_RULE_MARKER = 'delegate the stage to that agent';

// Stable marker phrase for the CLI-only artifact rule: the deploy smoke fails
// when the generated SKILL.md lacks it, so rewording the artifact rule must
// update this constant deliberately. The rule pairs with the path-scoped
// file-write deny the v2 renderer emits for docs/changes/** (platform
// permissions) — the prompt layer covers the session agent and runtimes
// without permission support.
const ARTIFACT_RULE_MARKER = 'only via the sdlc CLI';

// Stable marker phrase for the change-identification section (FR-012, AC-034):
// the deploy smoke fails when the generated SKILL.md lacks it, so rewording
// the identification protocol must update this constant deliberately.
const IDENTIFICATION_RULE_MARKER = 'Change identification';

// The agentic-sdlc skill body is version-controlled at
// src/skills/agentic-sdlc/SKILL.md (same layout as knowledge-init); deploy
// reads it and ships it verbatim — no deploy-time interpolation.
function renderAgenticSdlcSkill() {
  const agenticSdlcSkillSource = path.join(
    root,
    'src',
    'skills',
    AGENTIC_SDLC_SKILL_ID,
    'SKILL.md'
  );

  if (!fs.existsSync(agenticSdlcSkillSource)) {
    fail(`Missing skill source file: ${agenticSdlcSkillSource}`);
  }

  return fs.readFileSync(agenticSdlcSkillSource, 'utf8');
}

/**
 * Reads the YAML frontmatter between the opening --- markers of a rendered
 * .md file. Used by the per-skill smoke (both deployed SKILL.md files) and
 * the per-agent smoke (TASK-010) to verify frontmatter invariants.
 */
function readFrontmatter(skillMdPath: string): Record<string, unknown> {
  const content = fs.readFileSync(skillMdPath, 'utf8');
  const lines = content.split('\n');

  if (lines[0]?.trim() !== '---') {
    fail(`Missing frontmatter in ${skillMdPath}`);
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }

  if (end === -1) {
    fail(`Unterminated frontmatter in ${skillMdPath}`);
  }

  const doc = parseYamlString(lines.slice(1, end).join('\n'), skillMdPath);

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(`Invalid frontmatter in ${skillMdPath}`);
  }

  return doc as Record<string, unknown>;
}

// Uniform per-skill smoke (DEC-008 pattern applied to every managed skill):
// the deployed SKILL.md must carry frontmatter whose name equals the deployed
// folder name and a non-empty description.
function smokeDeployedSkill(skillDir: string, skillId: string) {
  const frontmatter = readFrontmatter(path.join(skillDir, 'SKILL.md'));

  if (frontmatter.name !== skillId) {
    fail(
      `${skillId} smoke test failed: frontmatter name '${String(frontmatter.name)}' does not match the folder name '${skillId}'.`
    );
  }

  const description = frontmatter.description;
  if (typeof description !== 'string' || description.trim() === '') {
    fail(`${skillId} smoke test failed: frontmatter description is empty.`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const destArg = args.dest || (args._ as string[])[0];

  if (!destArg) {
    fail(
      'Usage: deploy-to-agent --dest <agent-root> ' +
      '[--platform <id>] [--platform-version <n>] [--clean] [--skip-smoke]'
    );
  }

  const destAbs = path.resolve(String(destArg));
  const agenticSdlcSkillAbs = path.join(destAbs, 'skills', AGENTIC_SDLC_SKILL_ID);
  const knowledgeInitSkillAbs = path.join(destAbs, 'skills', KNOWLEDGE_INIT_SKILL_ID);
  const agentsDirAbs = path.join(destAbs, 'agents');

  // Resolve the platform renderer (TASK-010). Unknown platforms and versions
  // fail fast with the registry's supported-values message, before the build.
  const platform = String(args.platform || 'opencode');
  const platformVersionArg = args['platform-version'];
  let renderer: AgentRenderer;
  try {
    renderer = getRenderer(
      platform,
      platformVersionArg === undefined ? 'latest' : Number(platformVersionArg)
    );
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  // Load the neutral agent roster from the repository (TASK-010). The roster
  // drives both the --clean stale-file sweep and the rendered output.
  let agents: AgentRecord[];
  try {
    agents = loadAgentRegistry(root);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  if (args.clean) {
    rmrf(agenticSdlcSkillAbs);
    rmrf(knowledgeInitSkillAbs);

    // Remove stale rendered agent files whose source definitions no longer
    // exist (TASK-010). An empty roster removes the whole agents directory.
    if (fs.existsSync(agentsDirAbs)) {
      if (agents.length === 0) {
        rmrf(agentsDirAbs);
      } else {
        const sourceIds = new Set(agents.map((agent) => agent.id));
        for (const entry of fs.readdirSync(agentsDirAbs, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const id = path.basename(entry.name, '.md');
          if (!sourceIds.has(id)) {
            fs.rmSync(path.join(agentsDirAbs, entry.name), { force: true });
          }
        }
      }
    }
  }

  ensureDir(path.join(agenticSdlcSkillAbs, 'scripts'));

  runBuild();

  const bundleFile = path.join(root, 'dist', 'sdlc.js');

  if (!fs.existsSync(bundleFile)) {
    fail(`Missing bundle file: ${bundleFile}`);
  }

  fs.copyFileSync(bundleFile, path.join(agenticSdlcSkillAbs, 'scripts', 'sdlc.js'));

  copyDir(path.join(root, 'src', 'schemas'), path.join(agenticSdlcSkillAbs, 'schemas'));
  copyDir(path.join(root, 'src', 'policies'), path.join(agenticSdlcSkillAbs, 'policies'));
  copyDir(path.join(root, 'src', 'stages'), path.join(agenticSdlcSkillAbs, 'stages'));
  compileStageHooks(path.join(agenticSdlcSkillAbs, 'stages'));

  fs.writeFileSync(
    path.join(agenticSdlcSkillAbs, 'SKILL.md'),
    `${renderAgenticSdlcSkill()}\n`,
    'utf8'
  );

  fs.writeFileSync(
    path.join(agenticSdlcSkillAbs, 'manifest.json'),
    `${JSON.stringify(
      {
        name: AGENTIC_SDLC_SKILL_ID,
        version: VERSION,
        deployedAt: new Date().toISOString(),
        cliPath: 'scripts/sdlc.js',
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  // knowledge-init (DEC-001), source-controlled at
  // src/skills/knowledge-init/SKILL.md. It ships SKILL.md and a manifest with
  // name, version, and deployedAt only (DEC-007) — no CLI, no scripts.
  const knowledgeInitSource = path.join(
    root,
    'src',
    'skills',
    KNOWLEDGE_INIT_SKILL_ID,
    'SKILL.md'
  );

  if (!fs.existsSync(knowledgeInitSource)) {
    fail(`Missing skill source file: ${knowledgeInitSource}`);
  }

  ensureDir(knowledgeInitSkillAbs);
  fs.copyFileSync(knowledgeInitSource, path.join(knowledgeInitSkillAbs, 'SKILL.md'));

  fs.writeFileSync(
    path.join(knowledgeInitSkillAbs, 'manifest.json'),
    `${JSON.stringify(
      {
        name: KNOWLEDGE_INIT_SKILL_ID,
        version: VERSION,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  // Render the neutral agent roster into the target platform's format
  // (TASK-010). Skills deploy identically for every platform; only the agent
  // files vary by platform/version.
  ensureDir(agentsDirAbs);
  const renderedAgents: { agent: AgentRecord; rendered: RenderedAgent }[] = [];
  for (const agent of agents) {
    const rendered = renderer.renderAgent(agent);
    fs.writeFileSync(path.join(destAbs, rendered.path), rendered.content, 'utf8');
    renderedAgents.push({ agent, rendered });
  }

  const skills: { name: string; smoke: string }[] = [];

  if (!args['skip-smoke']) {
    // agentic-sdlc: run the deployed CLI.
    const agenticSdlcRuntimeCli = path.join(agenticSdlcSkillAbs, 'scripts', 'sdlc.js');
    const result = spawnSync(
      process.execPath,
      [agenticSdlcRuntimeCli, '--list-commands'],
      {
        cwd: destAbs,
        encoding: 'utf8',
      }
    );

    if (result.status !== 0) {
      fail(
        `Deployment smoke test failed.\n${result.stdout || ''}\n${result.stderr || ''}`
      );
    }

    // Delegation-rule marker (CMP-005, AC-007): the generated SKILL.md must
    // state the firm delegation rule; its stable marker phrase gates the
    // deployment alongside the two-skill layout checks.
    const agenticSdlcSkillMd = fs.readFileSync(
      path.join(agenticSdlcSkillAbs, 'SKILL.md'),
      'utf8'
    );
    if (!agenticSdlcSkillMd.includes(DELEGATION_RULE_MARKER)) {
      fail(
        `Deployment smoke test failed: generated SKILL.md lacks the delegation rule marker phrase '${DELEGATION_RULE_MARKER}'.`
      );
    }

    // CLI-only artifact rule (CMP-005 pattern): the generated SKILL.md must
    // state that change artifacts are modified only via the sdlc CLI.
    if (!agenticSdlcSkillMd.includes(ARTIFACT_RULE_MARKER)) {
      fail(
        `Deployment smoke test failed: generated SKILL.md lacks the artifact rule marker phrase '${ARTIFACT_RULE_MARKER}'.`
      );
    }

    // Uniform frontmatter smoke across the managed skills.
    smokeDeployedSkill(agenticSdlcSkillAbs, AGENTIC_SDLC_SKILL_ID);
    smokeDeployedSkill(knowledgeInitSkillAbs, KNOWLEDGE_INIT_SKILL_ID);

    skills.push({ name: AGENTIC_SDLC_SKILL_ID, smoke: 'passed' });
    skills.push({ name: KNOWLEDGE_INIT_SKILL_ID, smoke: 'passed' });
  } else {
    skills.push({ name: AGENTIC_SDLC_SKILL_ID, smoke: 'skipped' });
    skills.push({ name: KNOWLEDGE_INIT_SKILL_ID, smoke: 'skipped' });
  }

  // Per-agent smoke report (TASK-010): frontmatter parses, description is
  // non-empty, and the filename stem matches the agent id.
  const agentsReport: { name: string; smoke: string }[] = [];

  if (!args['skip-smoke']) {
    for (const { agent, rendered } of renderedAgents) {
      const frontmatter = readFrontmatter(path.join(destAbs, rendered.path));

      const description = frontmatter.description;
      if (typeof description !== 'string' || description.trim() === '') {
        fail(
          `Agent smoke test failed: frontmatter description is empty for '${agent.id}'.`
        );
      }

      const stem = path.basename(rendered.path, '.md');
      if (stem !== agent.id) {
        fail(
          `Agent smoke test failed: filename stem '${stem}' does not match agent id '${agent.id}'.`
        );
      }

      // The rendered frontmatter must carry the effective model (DEC-004):
      // model_override when present, else the team recommendation.
      if (frontmatter.model !== agent.effectiveModel) {
        fail(
          `Agent smoke test failed: rendered model '${String(frontmatter.model)}' does not match the effective model '${agent.effectiveModel}' for '${agent.id}'.`
        );
      }

      agentsReport.push({ name: agent.id, smoke: 'passed' });
    }
  } else {
    for (const agent of agents) {
      agentsReport.push({ name: agent.id, smoke: 'skipped' });
    }
  }

  const smoke = [...skills, ...agentsReport].every((entry) => entry.smoke === 'passed')
    ? 'passed'
    : 'skipped';

  console.log(
    JSON.stringify(
      {
        ok: true,
        version: VERSION,
        dest: destAbs,
        skill: agenticSdlcSkillAbs,
        cliPath: 'scripts/sdlc.js',
        bundled: true,
        smoke,
        skills,
        platform,
        platformVersion: renderer.version,
        agents: agentsReport,
      },
      null,
      2
    )
  );
}

main();
