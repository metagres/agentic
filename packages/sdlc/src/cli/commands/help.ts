import type { CliCommand, CommandDescriptor } from '../protocol.ts';
import { HUMAN_FLAG, isHuman } from '../protocol.ts';

function buildHelpJson(commands: CommandDescriptor[]): string {
  return `${JSON.stringify({ commands })}\n`;
}

function buildHelpText(commands: CommandDescriptor[]): string {
  const lines: string[] = ['sdlc — deterministic SDLC toolkit CLI', '', 'Commands:'];
  for (const command of commands) {
    lines.push(`  ${command.name}  ${command.description}`);
    lines.push(`    Usage: ${command.usage}`);
    lines.push(`    Example: ${command.example}`);
  }
  return `${lines.join('\n')}\n`;
}

export const helpCommand: CliCommand = {
  descriptor: {
    name: '--help',
    description: 'List registered commands with meanings as JSON (readable list with --human).',
    usage: `sdlc --help [${HUMAN_FLAG}]`,
    example: 'sdlc --help',
  },
  triggerFlags: ['--help', '-h'],
  matches: (args) => args.includes('--help') || args.includes('-h') || args.length === 0,
  run: (ctx) => {
    const descriptors = ctx.commands.map((command) => command.descriptor);
    return isHuman(ctx.args) ? buildHelpText(descriptors) : buildHelpJson(descriptors);
  },
};
