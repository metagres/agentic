#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readYaml } from '../src/scripts/lib/yaml-io.ts';
import { loadStageRegistry, getStageById } from '../src/scripts/lib/stage-registry.ts';
import { loadAgentRegistry, getAgentById } from '../src/scripts/lib/agent-registry.ts';
import { checkAgentCompatibility } from '../src/scripts/lib/agent-permissions.ts';
import { findPromptMarkers } from '../src/scripts/lib/agent-prompt-marker.ts';
import { resolveAgentsDir } from '../src/scripts/lib/paths.ts';
import { CHECK_CATALOG } from '../src/scripts/lib/checks/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policiesDir = path.join(root, 'src', 'policies');
const stagesDir = path.join(root, 'src', 'stages');

const results: { file: string; ok: boolean; error?: string }[] = [];
let failed = false;

function check(file: string, fn: (doc: unknown) => void) {
  const filePath = path.join(policiesDir, file);
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing policy file: ${filePath}`);
    }
    const doc = readYaml(filePath);
    fn(doc);
    results.push({ file, ok: true });
  } catch (err: unknown) {
    failed = true;
    results.push({ file, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

check('errors.yaml', (doc: unknown) => {
  const d = doc as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') throw new Error('errors.yaml must be an object');
  const errors = d.errors as Record<string, unknown> | undefined;
  if (!errors || typeof errors !== 'object') throw new Error('errors.yaml must define errors');
  for (const [code, def] of Object.entries(errors)) {
    const entry = def as Record<string, unknown> | null;
    if (!entry || typeof entry.message !== 'string') {
      throw new Error(`errors.yaml entry '${code}' must define message`);
    }
  }
});

// Stage folder validation: every stage.yaml descriptor must validate against
// the stage meta-schema, structural-checks declarations must resolve against
// the capped catalog, and steps.yaml must be well-formed.
const ajv = new Ajv({ allErrors: true, strict: false });
try {
  addFormats(ajv);
} catch {
  // Optional.
}

const metaSchema = readYaml(path.join(root, 'src', 'schemas', 'stage.schema.yaml')) as Record<string, unknown>;
const compileDescriptor = ajv.compile(metaSchema);

if (!fs.existsSync(stagesDir)) {
  console.error(`Missing stages directory: ${stagesDir}`);
  process.exit(1);
}

for (const stageName of fs.readdirSync(stagesDir).sort()) {
  const folder = path.join(stagesDir, stageName);
  if (!fs.statSync(folder).isDirectory()) continue;

  // stage.yaml descriptor against the meta-schema.
  const descriptorPath = path.join(folder, 'stage.yaml');
  try {
    if (!fs.existsSync(descriptorPath)) {
      throw new Error(`missing stage.yaml`);
    }
    const descriptor = readYaml(descriptorPath) as Record<string, unknown>;
    const valid = compileDescriptor(descriptor);
    if (!valid) {
      throw new Error(
        `stage.yaml fails the meta-schema: ${(compileDescriptor.errors || [])
          .map((e) => `${e.instancePath} ${e.message}`)
          .join('; ')}`
      );
    }
    results.push({ file: `stages/${stageName}/stage.yaml`, ok: true });
  } catch (err: unknown) {
    failed = true;
    results.push({
      file: `stages/${stageName}/stage.yaml`,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // structural-checks.yaml declarations against the capped catalog.
  const checksPath = path.join(folder, 'structural-checks.yaml');
  if (fs.existsSync(checksPath)) {
    try {
      const doc = readYaml(checksPath) as { checks?: { check?: string; params?: unknown }[] } | null;
      if (!doc || !Array.isArray(doc.checks)) {
        throw new Error('structural-checks.yaml must define a checks list');
      }
      for (const entry of doc.checks) {
        const name = entry?.check;
        if (typeof name !== 'string' || !CHECK_CATALOG[name]) {
          throw new Error(`unknown check '${String(name)}'`);
        }
        const params = entry.params && typeof entry.params === 'object'
          ? (entry.params as Record<string, unknown>)
          : {};
        const missing = CHECK_CATALOG[name].requiredParams.filter((p) => params[p] === undefined);
        if (missing.length > 0) {
          throw new Error(`check '${name}' missing parameter(s): ${missing.join(', ')}`);
        }
      }
      results.push({ file: `stages/${stageName}/structural-checks.yaml`, ok: true });
    } catch (err: unknown) {
      failed = true;
      results.push({
        file: `stages/${stageName}/structural-checks.yaml`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // steps.yaml shape.
  const stepsPath = path.join(folder, 'steps.yaml');
  if (fs.existsSync(stepsPath)) {
    try {
      const doc = readYaml(stepsPath) as { steps?: Record<string, unknown> } | null;
      if (!doc || typeof doc.steps !== 'object' || doc.steps === null) {
        throw new Error('steps.yaml must define a steps map');
      }
      results.push({ file: `stages/${stageName}/steps.yaml`, ok: true });
    } catch (err: unknown) {
      failed = true;
      results.push({
        file: `stages/${stageName}/steps.yaml`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // schema.yaml must compile as a JSON schema.
  const schemaPath = path.join(folder, 'schema.yaml');
  if (fs.existsSync(schemaPath)) {
    try {
      const schema = readYaml(schemaPath) as Record<string, unknown>;
      ajv.compile(schema);
      results.push({ file: `stages/${stageName}/schema.yaml`, ok: true });
    } catch (err: unknown) {
      failed = true;
      results.push({
        file: `stages/${stageName}/schema.yaml`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Requires graph must be a valid DAG with no missing references.
try {
  const registry = loadStageRegistry(root);
  const ids = new Set(registry.map((s) => s.id));
  for (const stage of registry) {
    for (const req of stage.requires) {
      if (!ids.has(req)) {
        throw new Error(`stage '${stage.id}' requires unknown stage '${req}'`);
      }
    }
  }
  results.push({ file: 'requires-graph', ok: true });
} catch (err: unknown) {
  failed = true;
  results.push({
    file: 'requires-graph',
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
}

// Agent definitions and stage-to-agent bindings are engine-level config
// cross-checks (like the requires graph above), not capped-catalog stage
// checks: every agent must validate against the agent meta-schema, keep its
// system prompt free of CLI/skill markers, and every stage binding must
// resolve with compatible permissions. A missing or empty agents roster is
// valid and passes silently.
const agentsDir = resolveAgentsDir(root);
const agentFiles = agentsDir && fs.existsSync(agentsDir)
  ? fs
      .readdirSync(agentsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
      .map((entry) => entry.name)
      .sort()
  : [];

if (agentFiles.length > 0 && agentsDir) {
  const compileAgent = ajv.compile(
    readYaml(path.join(root, 'src', 'schemas', 'agent.schema.yaml')) as Record<string, unknown>
  );

  for (const fileName of agentFiles) {
    const agentFile = path.join(agentsDir, fileName);
    const label = `agents/${fileName}`;

    // agent.yaml against the agent meta-schema; the descriptor id must equal
    // the filename stem.
    let doc: Record<string, unknown> = {};
    try {
      const parsed = readYaml(agentFile) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('descriptor is not an object');
      }
      doc = parsed as Record<string, unknown>;
    } catch (err: unknown) {
      failed = true;
      results.push({
        file: label,
        ok: false,
        error: `AGENT_SCHEMA_INVALID: ${label} has invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    try {
      const valid = compileAgent(doc);
      if (!valid) {
        throw new Error(
          `${label} fails the agent meta-schema: ${(compileAgent.errors || [])
            .map((e) => `${e.instancePath} ${e.message}`)
            .join('; ')}`
        );
      }
      const stem = fileName.slice(0, -'.yaml'.length);
      if (doc.id !== stem) {
        throw new Error(
          `${label} descriptor id '${String(doc.id)}' does not match the filename stem '${stem}'`
        );
      }
      results.push({ file: label, ok: true });
    } catch (err: unknown) {
      failed = true;
      results.push({
        file: label,
        ok: false,
        error: `AGENT_SCHEMA_INVALID: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Prompt purity: the personality prose must not reference the toolkit's
    // CLI flags, script path, or envelope directive phrases.
    try {
      const prompt = typeof doc.system_prompt === 'string' ? doc.system_prompt : '';
      const markers = findPromptMarkers(prompt);
      if (markers.length > 0) {
        throw new Error(
          `${label} system prompt contains marker(s): ${markers.map((m) => `'${m}'`).join(', ')}`
        );
      }
      results.push({ file: `${label}#system_prompt`, ok: true });
    } catch (err: unknown) {
      failed = true;
      results.push({
        file: `${label}#system_prompt`,
        ok: false,
        error: `AGENT_PROMPT_MARKER: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Every stage.yaml agent reference must resolve against the agents registry.
  try {
    const stages = loadStageRegistry(root);
    const unresolved: string[] = [];
    for (const stage of stages) {
      if (stage.agent && !getAgentById(root, stage.agent)) {
        unresolved.push(`stage '${stage.id}' references unknown agent '${stage.agent}'`);
      }
    }
    if (unresolved.length > 0) {
      throw new Error(unresolved.join('; '));
    }
    results.push({ file: 'agents/references', ok: true });
  } catch (err: unknown) {
    failed = true;
    results.push({
      file: 'agents/references',
      ok: false,
      error: `AGENT_REF_UNRESOLVED: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Stage-to-agent bindings must satisfy the permission compatibility check.
  try {
    const stages = loadStageRegistry(root);
    const agents = loadAgentRegistry(root);
    const findings = checkAgentCompatibility(stages, agents);
    if (findings.length > 0) {
      throw new Error(
        findings
          .map(
            (f) =>
              `stage '${f.stage}', agent '${f.agent}', key '${f.key}', required '${f.required}', actual '${f.actual}'` +
              (f.conflict_with ? `, conflict_with '${f.conflict_with}'` : '')
          )
          .join('; ')
      );
    }
    results.push({ file: 'agents/permissions', ok: true });
  } catch (err: unknown) {
    failed = true;
    results.push({
      file: 'agents/permissions',
      ok: false,
      error: `AGENT_PERMISSION_INCOMPATIBLE: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// The registry must resolve every stage the runtime expects.
for (const expected of ['requirements', 'design', 'planning', 'implementation', 'knowledge-extraction']) {
  if (!getStageById(root, expected)) {
    failed = true;
    results.push({ file: `stage/${expected}`, ok: false, error: 'not discovered' });
  }
}

console.log(
  JSON.stringify(
    {
      ok: !failed,
      policies: results,
    },
    null,
    2
  )
);

process.exit(failed ? 1 : 0);
