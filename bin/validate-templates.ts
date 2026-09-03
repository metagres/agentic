#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readYaml, parseYamlString } from '../src/scripts/lib/yaml-io.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagesDir = path.join(root, 'src', 'stages');
const skillsDir = path.join(root, 'src', 'skills');

const expectedKeys = {
  requirements: [
    'metadata',
    'problem_statement',
    'discovery_log',
    'assumptions',
    'functional_requirements',
    'non_functional_requirements',
    'out_of_scope',
    'failure_paths',
    'risks_and_dependencies',
    'delta',
  ],

  design: [
    'metadata',
    'context_summary',
    'components',
    'data_models',
    'apis',
    'flows',
    'decisions',
    'traceability',
    'delta',
  ],

  planning: [
    'metadata',
    'tasks',
    'milestones',
    'risks',
    'delta',
  ],
};

const expectedStage = {
  requirements: 'requirements',
  design: 'design',
  planning: 'planning',
};

const results = [];
let failed = false;

// Validate the stage-folder templates (TASK-005 moved the templates into the
// stage folders alongside their schemas).
for (const [stageId, keys] of Object.entries(expectedKeys)) {
  const templatePath = path.join(stagesDir, stageId, 'template.yaml');

  try {
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Missing template file: ${templatePath}`);
    }

    const doc = readYaml(templatePath) as Record<string, unknown>;

    const missingKeys = keys.filter((key: string) => !(key in doc));

    if (missingKeys.length > 0) {
      throw new Error(`Missing top-level keys: ${missingKeys.join(', ')}`);
    }

    const metadata = doc.metadata as Record<string, unknown> | undefined;
    if (!metadata || typeof metadata !== 'object') {
      throw new Error('metadata must be an object');
    }

    const expected = (expectedStage as Record<string, string>)[stageId];

    if (metadata.stage !== expected) {
      throw new Error(
        `metadata.stage should be '${expected}', found '${metadata.stage}'`
      );
    }

    // Requirements initialization contract (CMP-010, AC-016): the template must
    // start with both confirmation flags false so a freshly created change
    // routes into discovery first.
    if (stageId === 'requirements') {
      if (metadata.discovery_reviewed !== false || metadata.scenarios_reviewed !== false) {
        throw new Error(
          'requirements template must initialize discovery_reviewed and scenarios_reviewed to false'
        );
      }

      // Nested acceptance-criteria contract (CMP-004, AC-019): the template
      // must seed at least one requirement entry carrying a non-empty nested
      // acceptance_criteria array, so the parsed scaffold shows the nested
      // shape and next-id allocation continues past the scaffold example.
      const frs = doc.functional_requirements as
        | { acceptance_criteria?: unknown[] }[]
        | undefined;
      const seeded = Array.isArray(frs) &&
        frs.some(
          (fr) =>
            fr !== null &&
            typeof fr === 'object' &&
            Array.isArray(fr.acceptance_criteria) &&
            fr.acceptance_criteria.length > 0
        );
      if (!seeded) {
        throw new Error(
          'requirements template must seed at least one requirement entry with a non-empty nested acceptance_criteria array'
        );
      }
    }

    results.push({
      file: `stages/${stageId}/template.yaml`,
      ok: true,
    });
  } catch (err: unknown) {
    failed = true;

    results.push({
      file: `stages/${stageId}/template.yaml`,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Validate skill folders: every folder under src/skills must carry a SKILL.md
// whose frontmatter (the YAML block between the opening --- markers) has a
// name equal to the folder name and a non-empty description.
const skillResults: { file: string; ok: boolean; error?: string }[] = [];

if (!fs.existsSync(skillsDir)) {
  failed = true;
  skillResults.push({ file: 'src/skills', ok: false, error: 'Missing skills directory' });
} else {
  const skillFolders = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const folderName of skillFolders) {
    const skillMdPath = path.join(skillsDir, folderName, 'SKILL.md');

    try {
      if (!fs.existsSync(skillMdPath)) {
        throw new Error(`Missing SKILL.md in skill folder '${folderName}'`);
      }

      const lines = fs.readFileSync(skillMdPath, 'utf8').split('\n');

      if (lines[0]?.trim() !== '---') {
        throw new Error('SKILL.md is missing frontmatter');
      }

      let end = -1;
      for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].trim() === '---') {
          end = i;
          break;
        }
      }

      if (end === -1) {
        throw new Error('SKILL.md frontmatter is not terminated');
      }

      const frontmatter = parseYamlString(
        lines.slice(1, end).join('\n'),
        `skills/${folderName}/SKILL.md`
      );

      if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
        throw new Error('SKILL.md frontmatter is not a YAML mapping');
      }

      const name = (frontmatter as Record<string, unknown>).name;
      if (name !== folderName) {
        throw new Error(
          `frontmatter name '${String(name)}' does not match folder name '${folderName}'`
        );
      }

      const description = (frontmatter as Record<string, unknown>).description;
      if (typeof description !== 'string' || description.trim() === '') {
        throw new Error('frontmatter description must be a non-empty string');
      }

      skillResults.push({ file: `skills/${folderName}/SKILL.md`, ok: true });
    } catch (err: unknown) {
      failed = true;
      skillResults.push({
        file: `skills/${folderName}/SKILL.md`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: !failed,
      templates: results,
      skills: skillResults,
    },
    null,
    2
  )
);

process.exit(failed ? 1 : 0);
