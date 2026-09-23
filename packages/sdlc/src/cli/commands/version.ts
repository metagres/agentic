import packageJson from '../../../package.json' with { type: 'json' };
import type { CliCommand } from '../protocol.ts';
import { HUMAN_FLAG, isHuman } from '../protocol.ts';

// Name and version derive from the package manifest (single source); tsup
// inlines the JSON import at build time, so the bundled binary needs no
// manifest at runtime.
export const versionCommand: CliCommand = {
  descriptor: {
    name: '--version',
    description: 'Print the toolkit version as JSON (raw version string with --human).',
    usage: `sdlc --version [${HUMAN_FLAG}]`,
    example: 'sdlc --version',
  },
  triggerFlags: ['--version'],
  matches: (args) => args.includes('--version'),
  run: (ctx) =>
    isHuman(ctx.args)
      ? `${packageJson.version}\n`
      : `${JSON.stringify({ name: packageJson.name, version: packageJson.version })}\n`,
};
