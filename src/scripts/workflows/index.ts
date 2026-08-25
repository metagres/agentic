import path from 'node:path';

import { getStageById, getStageDescriptions } from '../lib/stage-registry.ts';
import { runStage } from '../lib/kinds/index.ts';
import { runStatus } from './status.ts';
import { runFeedback } from './feedback.ts';
import { runDoctor } from './doctor.ts';
import { parseArgs } from '../lib/cli.ts';

interface WorkflowEntry {
  id: string;
  description: string;
  run: (argv: string[]) => void | Promise<void>;
}

// Cross-cutting commands operate on the stage registry and are not stages.
const CROSS_CUTTING: Record<string, WorkflowEntry> = {
  status: {
    id: 'status',
    description: 'Show pipeline state for a change.',
    run(argv: string[]) { runStatus(argv); },
  },
  feedback: {
    id: 'feedback',
    description: 'Pauses current stage and reverts a previous stage to draft for corrections.',
    run(argv: string[]) { runFeedback(argv); },
  },
  doctor: {
    id: 'doctor',
    description: 'Check contracts, schemas, policies, stages, and docs index.',
    run(argv: string[]) { runDoctor(argv); },
  },
};

export const aliases: Record<string, string> = {
  docs: 'knowledge-extraction',
  knowledge: 'knowledge-extraction',
};

/**
 * Registry-driven resolution (CMP-006): a command that matches a discovered
 * stage dispatches to its kind interpreter; cross-cutting commands dispatch
 * separately. The dedicated review command is removed; review stages are
 * invoked as stage commands (sdlc requirements-review --change <change-name>).
 */
export function resolveWorkflow(command: string | undefined): WorkflowEntry | null {
  if (!command) return null;
  const id = aliases[command] || command;

  if (CROSS_CUTTING[id]) return CROSS_CUTTING[id];

  const stage = getStageById(process.cwd(), id);
  if (!stage) return null;

  return {
    id: stage.id,
    description: stage.title,
    run(argv: string[]) {
      const cwd = parseArgs(argv).cwd
        ? path.resolve(String(parseArgs(argv).cwd))
        : process.cwd();
      return runStage(stage, argv, cwd);
    },
  };
}

export function listWorkflows(): { id: string; description: string }[] {
  const stages = getStageDescriptions(process.cwd());
  const crossCutting = Object.values(CROSS_CUTTING).map((workflow) => ({
    id: workflow.id,
    description: workflow.description,
  }));
  return [...stages, ...crossCutting];
}
