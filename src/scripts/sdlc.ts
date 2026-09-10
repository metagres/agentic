#!/usr/bin/env node
import { writeJson, EXIT, CWD_FLAG_DOC } from './lib/cli.ts';
import { resolveCommand, listCommands } from './workflows/index.ts';
import { VERSION } from './lib/version.ts';

const argv = process.argv.slice(2);
const command = argv[0];

if (!command || command === '--help' || command === '-h') {
  writeJson(
    {
      command: 'cli',
      step: 'help',
      state: 'ok',
      instructions:
        'Usage: sdlc <stage|command> [flags]. ' +
        'Use --list-commands to see available commands. ' +
        'Use status --change <change-name> for pipeline state. ' +
        CWD_FLAG_DOC,
      data: {
        version: VERSION,
        commands: listCommands(),
      },
      errors: [],
      warnings: [],
    },
    EXIT.ok
  );
}

if (command === '--version') {
  writeJson(
    {
      command: 'cli',
      step: 'version',
      state: 'ok',
      instructions: `agentic-sdlc version ${VERSION}`,
      data: {
        version: VERSION,
      },
      errors: [],
      warnings: [],
    },
    EXIT.ok
  );
}

if (command === '--list-commands') {
  writeJson(
    {
      command: 'cli',
      step: 'list',
      state: 'ok',
      instructions: 'Available commands.',
      data: {
        version: VERSION,
        commands: listCommands(),
      },
      errors: [],
      warnings: [],
    },
    EXIT.ok
  );
}

const resolved = resolveCommand(command);

if (!resolved) {
  writeJson(
    {
      command,
      step: 'blocked',
      state: 'blocked',
      instructions:
        `Unknown command: ${command}. Use --list-commands to see available commands.`,
      data: {
        version: VERSION,
        commands: listCommands(),
      },
      errors: [
        {
          code: 'UNKNOWN_COMMAND',
          message: `Unknown command: ${command}`,
        },
      ],
      warnings: [],
    },
    EXIT.usage
  );
} else {
  await resolved.run(argv.slice(1));
}
