export { getStepDefinitions } from '../lib/steps-loader.ts';
import type { StepDefinition } from '../lib/steps-loader.ts';

export const skillManifest = {
  id: 'agentic-sdlc',
  title: 'Agentic SDLC',
  description:
    'Manages the full SDLC lifecycle via the sdlc CLI — requirements, design, ' +
    'planning, implementation, review, feedback, knowledge-extraction. ' +
    'Run scripts/sdlc.js status and follow the instructions field.',
};

// Step definitions are loaded per stage from each stage's steps.yaml
// (CMP-007). This export preserves the legacy consumer shape for callers that
// import the manifest directly; getStepDefinitions is the loader-backed lookup.
export type { StepDefinition };
