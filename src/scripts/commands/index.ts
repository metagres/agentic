import { getStageById, getStageDescriptions } from '../lib/stage-registry.ts';
import { getAgentModelFields } from '../lib/agent-registry.ts';
import { runStage } from '../lib/kinds/index.ts';
import { runStatus } from './status.ts';
import { runChanges } from './changes.ts';
import { runFeedback } from './feedback.ts';
import { runDoctor } from './doctor.ts';
import { runInit } from './init.ts';
import { parseArgs, resolveCwd } from '../lib/cli.ts';

interface CommandEntry {
  id: string;
  description: string;
  agent: string | null;
  run: (argv: string[]) => void | Promise<void>;
}

// Cross-cutting commands operate on the stage registry and are not stages.
// They are never bound to a dedicated agent: agent is null, meaning the
// current agent runs the command.
const CROSS_CUTTING: Record<string, CommandEntry> = {
  init: {
    id: 'init',
    description: 'Create a new change directory (mkdir-only; no artifacts, no stage engagement).',
    agent: null,
    run(argv: string[]) { runInit(argv); },
  },
  changes: {
    id: 'changes',
    description: 'List every change with tracked per-stage statuses and open feedback.',
    agent: null,
    run(argv: string[]) { runChanges(argv); },
  },
  status: {
    id: 'status',
    description: 'Show pipeline state for a change.',
    agent: null,
    run(argv: string[]) { runStatus(argv); },
  },
  feedback: {
    id: 'feedback',
    description: 'Pauses current stage and reverts a previous stage to draft for corrections.',
    agent: null,
    run(argv: string[]) { runFeedback(argv); },
  },
  doctor: {
    id: 'doctor',
    description: 'Check contracts, schemas, policies, stages, and docs index.',
    agent: null,
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
export function resolveCommand(command: string | undefined): CommandEntry | null {
  if (!command) return null;
  const id = aliases[command] || command;

  if (CROSS_CUTTING[id]) return CROSS_CUTTING[id];

  const stage = getStageById(process.cwd(), id);
  if (!stage) return null;

  return {
    id: stage.id,
    description: stage.title,
    agent: stage.agent,
    run(argv: string[]) {
      return runStage(stage, argv, resolveCwd(parseArgs(argv)));
    },
  };
}

/**
 * Command summaries for envelope data (DEC-004): a bound agent entry carries
 * the recommended model and the effectiveModel (model_override ?? model) so an
 * override is visible without reading source files. Cross-cutting entries keep
 * agent null and carry no model fields.
 */
export function listCommands(): {
  id: string;
  description: string;
  agent: string | null;
  model?: string;
  effectiveModel?: string;
}[] {
  const cwd = process.cwd();
  const stages = getStageDescriptions(cwd).map((stage) => ({
    ...stage,
    ...getAgentModelFields(cwd, stage.agent),
  }));
  const crossCutting = Object.values(CROSS_CUTTING).map((entry) => ({
    id: entry.id,
    description: entry.description,
    agent: entry.agent,
  }));
  return [...stages, ...crossCutting];
}
