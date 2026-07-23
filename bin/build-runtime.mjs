#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  let esbuild;

  try {
    esbuild = await import('esbuild');
  } catch {
    console.error(
      '[build-runtime] esbuild is not installed. Run: npm install'
    );
    process.exit(1);
  }

  const outfile = path.join(root, 'dist', 'sdlc.mjs');

  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'scripts', 'sdlc.mjs')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile,
    banner: {
      js: [
        "import { createRequire } from 'module';",
        'const require = createRequire(import.meta.url);',
      ].join('\n'),
    },
    logLevel: 'info',
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outfile,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
