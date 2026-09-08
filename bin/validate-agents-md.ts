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

function collectCodemaps(dir: string, relBase: string, out: PolicyFile[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const abs = path.join(dir, entry.name);
    const rel = `${relBase}/${entry.name}`;
    if (entry.isDirectory()) {
      collectCodemaps(abs, rel, out);
    } else if (entry.name === 'codemap.md') {
      out.push({ path: rel, content: fs.readFileSync(abs, 'utf8') });
    }
  }
}

const rootCodemap = path.join(root, 'codemap.md');
if (fs.existsSync(rootCodemap)) {
  citationFiles.push({ path: 'codemap.md', content: fs.readFileSync(rootCodemap, 'utf8') });
}
collectCodemaps(path.join(root, 'src'), 'src', citationFiles);
collectCodemaps(path.join(root, 'bin'), 'bin', citationFiles);

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
