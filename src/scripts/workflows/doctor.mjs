import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, writeJson, EXIT } from '../lib/cli.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function findDir(name, cwd) {
  const candidates = [
    path.resolve(scriptDir, '..', name),
    path.resolve(scriptDir, '..', '..', name),
    path.resolve(scriptDir, '..', '..', '..', name),
    path.resolve(cwd, 'src', name),
    path.resolve(cwd, name),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function runDoctor(argv) {
  const args = parseArgs(argv);
  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
  const strict = Boolean(args.strict);

  const checks = [];
  const errors = [];
  const warnings = [];

  function addCheck(id, passed, details = '') {
    checks.push({ id, passed, details });
  }

  const contractsDir = findDir('contracts', cwd);
  if (contractsDir) {
    addCheck('contracts_available', true, contractsDir);
  } else {
    addCheck('contracts_available', false, 'No contracts directory found');
    errors.push({
      code: 'CONTRACT_MISSING',
      message: 'No contracts directory found.',
    });
  }

  const schemasDir = findDir('schemas', cwd);
  if (schemasDir) {
    addCheck('schemas_available', true, schemasDir);
  } else {
    addCheck('schemas_available', false, 'No schemas directory found');
    errors.push({
      code: 'SCHEMAS_MISSING',
      message: 'No schemas directory found.',
    });
  }

  const policiesDir = findDir('policies', cwd);
  if (policiesDir) {
    addCheck('policies_available', true, policiesDir);
  } else {
    addCheck('policies_available', false, 'No policies directory found');
    errors.push({
      code: 'POLICIES_MISSING',
      message: 'No policies directory found.',
    });
  }

  const templatesDir = findDir('templates', cwd);
  if (templatesDir) {
    addCheck('templates_available', true, templatesDir);
  } else {
    addCheck('templates_available', false, 'No templates directory found');
    errors.push({
      code: 'TEMPLATES_MISSING',
      message: 'No templates directory found.',
    });
  }

  const docsIndex = path.join(cwd, 'docs', 'current', 'index.md');
  if (fs.existsSync(docsIndex)) {
    addCheck('docs_index_present', true, docsIndex);
  } else {
    addCheck('docs_index_present', false, docsIndex);
    const issue = {
      code: 'DOCS_INDEX_MISSING',
      message: 'docs/current/index.md not found. Run: sdlc docs-init',
    };

    if (strict) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  const state = errors.length > 0 ? 'blocked' : 'ok';
  const instructions =
    errors.length > 0
      ? 'Doctor found blocking configuration problems.'
      : strict
        ? 'Doctor checks passed in strict mode.'
        : 'Doctor checks passed.';

  writeJson(
    {
      workflow: 'doctor',
      step: 'check',
      state,
      instructions,
      data: {
        cwd,
        strict,
        checks,
      },
      errors,
      warnings,
    },
    EXIT.ok
  );
}
