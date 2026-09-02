#!/usr/bin/env node
import { writeJson, EXIT, CWD_FLAG_DOC } from './lib/cli.ts';
import { resolveWorkflow, listWorkflows } from './workflows/index.ts';
import { VERSION } from './lib/version.ts';

const argv = process.argv.slice(2);
const command = argv[0];

if (!command || command === '--help' || command === '-h') {
  writeJson(
    {
      workflow: 'cli',
      step: 'help',
      state: 'ok',
      instructions:
        'Usage: sdlc <stage|command> [flags]. ' +
        'Use --list-workflows to see workflows. ' +
        'Use status --change <change-name> for pipeline state. ' +
        CWD_FLAG_DOC,
      data: {
        version: VERSION,
        workflows: listWorkflows(),
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
      },
      errors: [],
      warnings: [],
    },
    EXIT.ok
  );
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
} else {
  await workflow.run(argv.slice(1));
}
