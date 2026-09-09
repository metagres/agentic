/**
 * docs-gen crosscheck gate: the seven mechanical cross-checks plus the
 * dead-reference scan, enforced as hard failing checks after the manifest
 * loop. Enforcement-only (DEC-001/DEC-002): violations abort the run through
 * a thrown error naming each failing check — nothing about check results is
 * rendered or persisted anywhere.
 *
 * Check logic is extracted verbatim from the retired index provider
 * (DEC-007): same inputs (in-flight rendered docs + repo scans), same
 * pass/fail semantics.
 */

import fs from 'node:fs';
import path from 'node:path';

import { findImportSites, scanDeadReferences } from './scans.ts';
import { tableRowsUnderHeading } from './table.ts';
import { DocsGenError } from './splice.ts';
import type { ProviderContext } from './types.ts';

export interface CrosscheckFinding {
  /** The violated mechanical check (one of the seven cross-checks or STALE-REF). */
  check: string;
  /** The offending file, entity, command, or missing path. */
  message: string;
}

/** Declared entity → command-surface mapping (check 1 and check 2). */
const ENTITY_COMMANDS: Record<string, string[]> = {
  'Stage Descriptor (stage.yaml)': [
    'sdlc <stage-id>',
    'sdlc requirements',
    'sdlc design',
    'sdlc planning',
    'sdlc implementation',
  ],
  'CLI Envelope': ['sdlc --list-workflows', 'sdlc status', 'sdlc feedback', 'sdlc doctor'],
  'Artifact Status': ['sdlc feedback', 'sdlc <review-stage>'],
  'Review Round (review file rounds[])': [
    'sdlc <review-stage>',
    'sdlc requirements-review',
    'sdlc design-review',
    'sdlc planning-review',
    'sdlc implementation-review',
  ],
  'Docs Delta (docs-delta.yaml)': ['sdlc knowledge-extraction'],
  'Plan Task (plan.yaml)': ['sdlc implementation'],
  'Skill Folder (src/skills)': ['npm run deploy:smoke'],
  'Agent Definition (src/agents/<agent-id>.yaml)': [
    'sdlc <stage-id>',
    'node bin/deploy-to-agent.ts',
  ],
  'Kind Permission Contract': ['node bin/deploy-to-agent.ts'],
  'Platform Renderer': ['node bin/deploy-to-agent.ts'],
  'Agent Audit (src/skills/agent-audit/SKILL.md)': ['agent skill (not a CLI command)'],
  'Model Override': ['sdlc <stage-id>', 'node bin/deploy-to-agent.ts'],
  'Improvement Review (src/skills/improvement-review)': ['agent skill (not a CLI command)'],
  'Idea Document (docs/ideas/<slug>.md)': ['agent skill (not a CLI command)'],
};

/** Technologies decisions may cite; each must appear in the tech stack. */
const TECH_VOCABULARY = ['YAML', 'Node.js', 'tsup', 'ajv', 'TypeScript'];

const CROSS_CUTTING = ['status', 'feedback', 'doctor'];

/**
 * Runs the seven mechanical cross-checks and the dead-reference scan against
 * the in-flight rendered docs and the repo. Throws a DocsGenError listing
 * every finding when any check violates; returns silently on a clean tree.
 */
export function runCrosschecks(ctx: ProviderContext): void {
  const findings: CrosscheckFinding[] = [];

  const glossary = ctx.readExisting('docs/current/glossary.md');
  const architecture = ctx.readExisting('docs/current/architecture.md');
  const capabilities = ctx.readExisting('docs/current/capabilities.md');
  const dependencies = ctx.readExisting('docs/current/dependencies.md');
  const knownIssues = ctx.readExisting('docs/current/known-issues.md');
  const decisions = ctx.readExisting('docs/current/decisions.md');

  const stageIds = stageIdsFromRegistry(ctx.root);
  const npmScripts = npmScriptNames(ctx.root);
  const bins = binFiles(ctx.root);

  // Check 1: every glossary entity declares a mapping; concrete targets exist.
  const entities = entityHeadings(glossary);
  for (const entity of entities) {
    const mapped = ENTITY_COMMANDS[entity];
    if (!mapped || mapped.length === 0) {
      findings.push({
        check: 'glossary-entity-commands',
        message: `glossary entity '${entity}' maps to no CLI command or bin`,
      });
      continue;
    }
    for (const token of mapped) {
      if (!mappedTargetExists(token, stageIds, npmScripts, bins)) {
        findings.push({
          check: 'glossary-entity-commands',
          message: `entity '${entity}' maps to unknown command '${token}'`,
        });
      }
    }
  }

  // Check 2: every stage and cross-cutting command is covered by an entity.
  const mappedText = JSON.stringify(ENTITY_COMMANDS);
  for (const id of [...stageIds, ...CROSS_CUTTING]) {
    if (!mappedText.includes(id)) {
      findings.push({
        check: 'command-coverage',
        message: `command '${id}' maps to no glossary entity`,
      });
    }
  }

  // Check 3: every architecture folder appears in at least one other doc.
  const otherDocs = [dependencies, knownIssues, glossary, capabilities, decisions]
    .concat([ctx.readExisting('docs/current/api-contract.md'), ctx.readExisting('docs/current/operations.md'), ctx.readExisting('docs/current/conventions.md')]);
  for (const folder of architectureFolders(architecture)) {
    const covered = otherDocs.some((doc) => doc.includes(folder));
    if (!covered) {
      findings.push({
        check: 'architecture-folder-coverage',
        message: `architecture folder '${folder}' appears in no other doc`,
      });
    }
  }

  // Check 4: scan-found known-issue locations live under architecture folders.
  const folders = architectureFolders(architecture);
  for (const location of tableRowsUnderHeading(knownIssues, 'Markers').map((row) => row[0] ?? '')) {
    const clean = location.replace(/\s*\(.*\)\s*$/, '');
    if (clean && !folders.some((folder) => clean.startsWith(folder))) {
      findings.push({
        check: 'known-issue-locations',
        message: `known-issue location '${location}' is not under an architecture folder`,
      });
    }
  }

  // Check 5: every capability row cites a related entity or endpoint.
  for (const row of tableRowsUnderHeading(capabilities, 'Capabilities')) {
    const relatedEntities = (row[2] ?? '').trim();
    const relatedEndpoints = (row[3] ?? '').trim();
    if (isPlaceholder(relatedEntities) && isPlaceholder(relatedEndpoints)) {
      findings.push({
        check: 'capability-citations',
        message: `capability '${row[0] ?? '?'}' cites no related entity or endpoint`,
      });
    }
  }

  // Check 6: every runtime dependency is imported somewhere.
  for (const row of tableRowsUnderHeading(dependencies, 'Key Dependencies')) {
    const name = row[0] ?? '';
    if (!name) continue;
    const imported =
      findImportSites(ctx.root, name).length > 0 ||
      findImportSites(ctx.root, name, ['generate_context.js']).length > 0;
    if (!imported) {
      findings.push({
        check: 'dependency-imports',
        message: `dependency '${name}' is never imported in source`,
      });
    }
  }

  // Check 7: every declared decision technology is in the tech stack.
  const techStack = techStackTechnologies(architecture);
  for (const tech of TECH_VOCABULARY) {
    if (!techStack.some((entry) => entry.toLowerCase().includes(tech.toLowerCase()))) {
      findings.push({
        check: 'tech-vocabulary',
        message: `decision technology '${tech}' is missing from the tech stack`,
      });
    }
  }

  // Hard dead-reference scan: a stale path reference fails the run (DEC-002).
  for (const hit of scanDeadReferences(ctx.root)) {
    findings.push({
      check: 'STALE-REF',
      message: `${hit.file}${hit.section ? ` (${hit.section})` : ''}: references missing ${hit.reference}`,
    });
  }

  if (findings.length > 0) {
    throw new DocsGenError(
      `cross-check violations (${findings.length}):\n - ${findings
        .map((finding) => `${finding.check}: ${finding.message}`)
        .join('\n - ')}`
    );
  }
}

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === '—' || trimmed === '-';
}

/** Validates one declared mapping token against the live command surface. */
function mappedTargetExists(
  token: string,
  stageIds: string[],
  npmScripts: Set<string>,
  bins: Set<string>
): boolean {
  const trimmed = token.trim();
  if (trimmed === 'agent skill (not a CLI command)') return true;
  if (trimmed.includes('<')) return true; // pattern reference (sdlc <stage-id>)
  const sdlcMatch = trimmed.match(/^sdlc ([\w-]+)$/);
  if (sdlcMatch) {
    return (
      sdlcMatch[1].startsWith('--') ||
      stageIds.includes(sdlcMatch[1]) ||
      CROSS_CUTTING.includes(sdlcMatch[1])
    );
  }
  const npmMatch = trimmed.match(/^npm run ([\w:.-]+)$/);
  if (npmMatch) return npmScripts.has(npmMatch[1]);
  const binMatch = trimmed.match(/^node (bin\/[\w.-]+\.ts)$/);
  if (binMatch) return bins.has(binMatch[1]);
  return stageIds.includes(trimmed) || CROSS_CUTTING.includes(trimmed);
}

function npmScriptNames(root: string): Set<string> {
  const raw = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
  return new Set(Object.keys(pkg.scripts ?? {}));
}

function binFiles(root: string): Set<string> {
  const binDir = path.join(root, 'bin');
  if (!fs.existsSync(binDir)) return new Set();
  return new Set(
    fs.readdirSync(binDir).filter((name) => name.endsWith('.ts')).map((name) => `bin/${name}`)
  );
}

function stageIdsFromRegistry(root: string): string[] {
  const stagesDir = path.join(root, 'src', 'stages');
  if (!fs.existsSync(stagesDir)) return [];
  return fs
    .readdirSync(stagesDir)
    .filter((name) => fs.statSync(path.join(stagesDir, name)).isDirectory())
    .sort();
}

function entityHeadings(glossary: string): string[] {
  const out: string[] = [];
  for (const line of glossary.split('\n')) {
    const match = line.match(/^## Entity: (.+?)\s*$/);
    if (match) out.push(match[1]);
  }
  return out;
}

function architectureFolders(architecture: string): string[] {
  return tableRowsUnderHeading(architecture, 'Folder Responsibilities')
    .map((row) => row[0] ?? '')
    .filter((folder) => folder.endsWith('/'));
}

function techStackTechnologies(architecture: string): string[] {
  return tableRowsUnderHeading(architecture, 'Tech Stack').map((row) => row[1] ?? '');
}
