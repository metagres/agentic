#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  lintAgentsMarkdown,
  type PolicyFile,
} from '../src/scripts/lib/agents-md-policy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const findings: { file: string; check: string; message: string }[] = [];

const agentsMdPath = path.join(root, 'AGENTS.md');
if (!fs.existsSync(agentsMdPath)) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        findings: [
          { file: 'AGENTS.md', check: 'existence', message: 'AGENTS.md is missing' },
        ],
      },
      null,
      2
    )
  );
  process.exit(1);
}

const agentsMd: PolicyFile = {
  path: 'AGENTS.md',
  content: fs.readFileSync(agentsMdPath, 'utf8'),
};

const citationFiles: PolicyFile[] = [];

const docsCurrentDir = path.join(root, 'docs', 'current');
const docsCurrentFileNames: string[] = [];
if (fs.existsSync(docsCurrentDir)) {
  for (const name of fs.readdirSync(docsCurrentDir).sort()) {
    if (!name.endsWith('.md')) {
      continue;
    }
    docsCurrentFileNames.push(name);
    // decisions.md renders archived change records verbatim (mechanical
    // render, append-only) — historical AGENTS.md section references in
    // accepted decision prose are quoted material, not live guidance, so
    // it is excluded from the section-reference lint.
    if (name === 'decisions.md') {
      continue;
    }
    citationFiles.push({
      path: `docs/current/${name}`,
      content: fs.readFileSync(path.join(docsCurrentDir, name), 'utf8'),
    });
  }
} else {
  findings.push({
    file: 'docs/current',
    check: 'existence',
    message: 'docs/current directory is missing',
  });
}

const skillsDir = path.join(root, 'src', 'skills');
if (fs.existsSync(skillsDir)) {
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      citationFiles.push({
        path: `src/skills/${entry.name}/SKILL.md`,
        content: fs.readFileSync(skillMd, 'utf8'),
      });
    }
  }
}

findings.push(
  ...lintAgentsMarkdown({ agentsMd, citationFiles, docsCurrentFileNames, pathExists: (rel) => fs.existsSync(path.join(root, rel)) })
);

console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
process.exit(findings.length === 0 ? 0 : 1);
