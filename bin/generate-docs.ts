#!/usr/bin/env node
/**
 * docs-gen CLI: regenerates the mechanically owned parts of docs/current/
 * from the docs-gen.yaml manifest. Without --check it rewrites the
 * manifest's files; with --check it renders in memory and exits non-zero
 * naming every drifted file when on-disk content differs — the
 * prettier-check pattern wired into npm run validate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadManifest } from '../src/scripts/lib/docs-gen/manifest.ts';
import { generateAll } from '../src/scripts/lib/docs-gen/run.ts';
import { providerRegistry } from '../src/scripts/lib/docs-gen/providers/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const help = process.argv.includes('--help');

if (help) {
  process.stdout.write('Usage: node bin/generate-docs.ts [--check]\n');
  process.exit(0);
}

const manifest = loadManifest(root);
const rendered = generateAll(root, manifest, providerRegistry);

const drift: { path: string; touchedBy: string[] }[] = [];

for (const file of rendered.values()) {
  const abs = path.join(root, file.path);
  const onDisk = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  if (onDisk === file.content) continue;
  drift.push({ path: file.path, touchedBy: file.touchedBy });
  if (!check) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.content, 'utf8');
  }
}

if (check) {
  console.log(
    JSON.stringify(
      {
        ok: drift.length === 0,
        changed: drift,
      },
      null,
      2
    )
  );
  process.exit(drift.length === 0 ? 0 : 1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      generated: [...rendered.values()].map((file) => file.path),
      changed: drift.map((entry) => entry.path),
    },
    null,
    2
  )
);
