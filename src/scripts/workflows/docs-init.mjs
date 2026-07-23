import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, writeJson, EXIT } from '../lib/cli.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_INDEX = `# Current Docs Index

| File | Purpose | When to Read | Notes |
|---|---|---|---|
| docs/current/overview.md | System overview | Start here | Maintained by knowledge extraction |
`;

const DEFAULT_OVERVIEW = `# Overview

This document is maintained by knowledge extraction.
`;

function findTemplate(cwd) {
  const candidates = [
    path.resolve(scriptDir, '..', 'templates', 'docs-current-index.md'),
    path.resolve(scriptDir, '..', '..', 'templates', 'docs-current-index.md'),
    path.resolve(scriptDir, '..', '..', '..', 'templates', 'docs-current-index.md'),
    path.resolve(cwd, 'src', 'templates', 'docs-current-index.md'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function runDocsInit(argv) {
  const args = parseArgs(argv);
  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
  const force = Boolean(args.force);

  const docsDir = path.join(cwd, 'docs', 'current');
  const indexPath = path.join(docsDir, 'index.md');
  const overviewPath = path.join(docsDir, 'overview.md');

  fs.mkdirSync(docsDir, { recursive: true });

  const warnings = [];
  const data = {
    docs_dir: docsDir,
    index: indexPath,
    overview: overviewPath,
  };

  if (fs.existsSync(indexPath) && !force) {
    warnings.push({
      code: 'DOCS_INDEX_EXISTS',
      message: 'docs/current/index.md already exists. Use --force to overwrite.',
    });

    writeJson(
      {
        workflow: 'docs-init',
        step: 'init',
        state: 'ok',
        instructions:
          'docs/current/index.md already exists. Use --force to overwrite.',
        data,
        errors: [],
        warnings,
      },
      EXIT.ok
    );
    return;
  }

  const template = findTemplate(cwd);
  let indexContent = DEFAULT_INDEX;

  if (template) {
    indexContent = fs.readFileSync(template, 'utf8');
    if (!indexContent.includes('docs/current/overview.md')) {
      indexContent = indexContent.trimEnd() + `
| docs/current/overview.md | System overview | Start here | Maintained by knowledge extraction |
`;
    }
  }

  fs.writeFileSync(indexPath, `${indexContent.trimEnd()}
`, 'utf8');

  if (!fs.existsSync(overviewPath) || force) {
    fs.writeFileSync(overviewPath, DEFAULT_OVERVIEW, 'utf8');
  }

  writeJson(
    {
      workflow: 'docs-init',
      step: 'init',
      state: 'complete',
      instructions: 'Created docs/current/index.md and docs/current/overview.md.',
      data,
      errors: [],
      warnings,
    },
    EXIT.ok
  );
}
