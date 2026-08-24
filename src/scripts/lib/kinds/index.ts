import type { StageRecord } from '../stage-registry.ts';
import { runAuthoringStage } from './authoring.ts';
import { runReviewStage } from './review.ts';
import { runTasksStage } from './tasks.ts';
import { runAggregatorStage } from './aggregator.ts';

/**
 * Dispatches a discovered stage to its kind interpreter (CMP-003, DEC-006).
 * Adding a stage of an existing kind requires no TypeScript change.
 */
export async function runStage(
  stage: StageRecord,
  argv: string[],
  cwd: string
): Promise<void> {
  switch (stage.kind) {
    case 'authoring':
      await runAuthoringStage(stage, argv, cwd);
      return;
    case 'review':
      await runReviewStage(stage, argv, cwd);
      return;
    case 'tasks':
      await runTasksStage(stage, argv, cwd);
      return;
    case 'aggregator':
      await runAggregatorStage(stage, argv, cwd);
      return;
    default:
      throw new Error(`Stage '${stage.id}' declares unknown kind '${String(stage.kind)}'.`);
  }
}
