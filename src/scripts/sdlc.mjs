#!/usr/bin/env node
import { writeJson, EXIT } from './lib/cli.mjs';
import { resolveWorkflow, listWorkflows } from './workflows/index.mjs';
import { runStatus } from './workflows/status.mjs';
import { VERSION } from './lib/version.mjs';

const argv = process.argv.slice(2);
const command = argv[0];

const utilities = [
  {
    id: 'status',
    description: 'Show pipeline state for a change directory.',
  },
];

if (!command || command === '--help' || command === '-h') {
  writeJson(
    {
      workflow: 'cli',
      step: 'help',
      state: 'ok',
      instructions:
        'Usage: sdlc <workflow|status> [flags]. ' +
        'Use --list-workflows to see workflows. ' +
        'Use status --dir <change-dir> for pipeline state.',
      data: {
        version: VERSION,
        workflows: listWorkflows(),
        utilities,
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
      workflow: 'cli',
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

if (command === '--list-workflows') {
  writeJson(
    {
      workflow: 'cli',
      step: 'list',
      state: 'ok',
      instructions: 'Available workflows.',
      data: {
        version: VERSION,
        workflows: listWorkflows(),
        utilities,
      },
      errors: [],
      warnings: [],
    },
    EXIT.ok
  );
}

if (command === 'status') {
  runStatus(argv.slice(1));
}

const workflow = resolveWorkflow(command);

if (!workflow) {
  writeJson(
    {
      workflow: command,
      step: 'blocked',
      state: 'blocked',
      instructions:
        `Unknown workflow: ${command}. Use --list-workflows to see available workflows.`,
      data: {
        version: VERSION,
        workflows: listWorkflows(),
        utilities,
      },
      errors: [
        {
          code: 'UNKNOWN_COMMAND',
          message: `Unknown workflow: ${command}`,
        },
      ],
      warnings: [],
    },
    EXIT.usage
  );
}

workflow.run(argv.slice(1));
