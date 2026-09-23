import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/sdlc-cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist/bin',
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from \'node:module\';\nconst require = createRequire(import.meta.url);',
  },
});
