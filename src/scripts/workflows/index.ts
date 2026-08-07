import { runAuthoringStage } from '../lib/runner.ts';
import { runReview } from './review.ts';
import { runImplementation } from './implementation.ts';
import { runKnowledgeExtraction } from './knowledge-extraction.ts';
import { runFeedback } from './feedback.ts';

interface WorkflowEntry {
  id: string;
  description: string;
  run: (argv: string[]) => void;
}

export const workflows: Record<string, WorkflowEntry> = {
  requirements: {
    id: 'requirements',
    description: 'Creates and finalizes requirements.yaml through discovery, assumptions, validation, and delta.',
    run(argv: string[]) { runAuthoringStage('requirements', argv); },
  },
  design: {
    id: 'design',
    description: 'Creates and finalizes design.yaml from requirements.yaml.',
    run(argv: string[]) { runAuthoringStage('design', argv); },
  },
  planning: {
    id: 'planning',
    description: 'Creates and finalizes plan.yaml from design.yaml and requirements.yaml.',
    run(argv: string[]) { runAuthoringStage('planning', argv); },
  },
  implementation: {
    id: 'implementation',
    description: 'Updates task execution state in plan.yaml.',
    run(argv: string[]) { runImplementation(argv); },
  },
  review: {
    id: 'review',
    description: 'Reviews requirements.yaml, design.yaml, plan.yaml, or implementation state.',
    run(argv: string[]) { runReview(argv); },
  },
  feedback: {
    id: 'feedback',
    description: 'Pauses current stage and reverts a previous stage to draft for corrections.',
    run(argv: string[]) { runFeedback(argv); },
  },
  'knowledge-extraction': {
    id: 'knowledge-extraction',
    description: 'Synchronizes docs/current from approved changes using docs-delta.yaml.',
    run(argv: string[]) { runKnowledgeExtraction(argv); },
  },
};

export const aliases: Record<string, string> = {
  docs: 'knowledge-extraction',
  knowledge: 'knowledge-extraction',
};

export function resolveWorkflow(command: string | undefined): WorkflowEntry | null {
  if (!command) return null;
  const id = aliases[command] || command;
  return workflows[id] || null;
}

export function listWorkflows(): { id: string; description: string }[] {
  return Object.values(workflows).map((workflow) => ({
    id: workflow.id,
    description: workflow.description,
  }));
}