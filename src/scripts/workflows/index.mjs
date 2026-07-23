import { runAuthoringStage } from '../lib/runner.mjs';
import { runReview } from './review.mjs';
import { runImplementation } from './implementation.mjs';
import { runKnowledgeExtraction } from './knowledge-extraction.mjs';

export const workflows = {
  requirements: {
    id: 'requirements',
    description:
      'Creates and finalizes requirements.yaml through discovery, assumptions, validation, and delta.',
    run(argv) {
      runAuthoringStage('requirements', argv);
    },
  },

  design: {
    id: 'design',
    description: 'Creates and finalizes design.yaml from requirements.yaml.',
    run(argv) {
      runAuthoringStage('design', argv);
    },
  },

  planning: {
    id: 'planning',
    description:
      'Creates and finalizes plan.yaml from design.yaml and requirements.yaml.',
    run(argv) {
      runAuthoringStage('planning', argv);
    },
  },

  implementation: {
    id: 'implementation',
    description: 'Updates task execution state in plan.yaml.',
    run(argv) {
      runImplementation(argv);
    },
  },

  review: {
    id: 'review',
    description:
      'Reviews requirements.yaml, design.yaml, plan.yaml, or implementation state.',
    run(argv) {
      runReview(argv);
    },
  },

  'knowledge-extraction': {
    id: 'knowledge-extraction',
    description:
      'Synchronizes docs/current from approved changes using docs-delta.yaml.',
    run(argv) {
      runKnowledgeExtraction(argv);
    },
  },
};

export const aliases = {
  docs: 'knowledge-extraction',
  knowledge: 'knowledge-extraction',
};

export function resolveWorkflow(command) {
  if (!command) return null;

  const id = aliases[command] || command;

  return workflows[id] || null;
}

export function listWorkflows() {
  return Object.values(workflows).map((workflow) => ({
    id: workflow.id,
    description: workflow.description,
  }));
}
