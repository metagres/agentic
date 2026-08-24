import path from 'node:path';

import { parseArgs, writeJson, EXIT } from '../lib/cli.ts';
import { safeReadYaml } from '../lib/context.ts';
import { requireChangeRoot } from '../lib/change-root.ts';
import { loadStageRegistry, getStageById } from '../lib/stage-registry.ts';
import { computePipelineOrder, evaluateGate } from '../lib/requires-graph.ts';
import type { ParseArgsResult } from '../lib/types.ts';

function usage(code: number = EXIT.ok): void {
  writeJson(
    {
      workflow: 'status',
      step: 'help',
      state: code === EXIT.ok ? 'ok' : 'blocked',
      instructions: 'Usage: sdlc status --dir <change-dir>',
      data: {},
      errors: [],
      warnings: [],
    },
    code
  );
}

// The tracked artifact of a review stage is the artifact of the stage it
// reviews; for every other stage it is its own artifact (DEC-008).
function trackedStage(cwd: string, stageId: string) {
  const stage = getStageById(cwd, stageId);
  if (!stage) return null;
  if (stage.kind === 'review' && stage.reviews) {
    return getStageById(cwd, stage.reviews);
  }
  return stage;
}

function readStageStatus(
  cwd: string,
  changeRoot: string,
  stageId: string
): string {
  const tracked = trackedStage(cwd, stageId);
  if (!tracked) return 'unknown';

  const artifact = safeReadYaml(
    path.join(changeRoot, tracked.artifact)
  ) as Record<string, unknown> | null;
  if (!artifact) return 'missing';

  const metadata = (artifact.metadata as Record<string, unknown>) || {};
  return String(metadata[tracked.statusField] || 'unknown');
}

export function runStatus(argv: string[]): void {
  const args = parseArgs(argv) as ParseArgsResult;

  if (args.help) {
    usage(EXIT.ok);
    return;
  }

  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();

  const base: Record<string, unknown> = {
    workflow: 'status',
    step: 'pipeline',
  };

  const changeRoot = requireChangeRoot(args, cwd, base);
  if (!changeRoot) return;
  const changeDir = path.basename(changeRoot);

  // Pipeline order derives from the requires DAG with an alphabetical
  // tie-break; no hardcoded pipeline map exists anymore.
  const registry = loadStageRegistry(cwd);
  const order = computePipelineOrder(cwd);

  const pipeline: Record<string, string> = {};
  for (const id of order) {
    pipeline[id] = readStageStatus(cwd, changeRoot, id);
  }

  // Check for open feedback first (unchanged behavior).
  const feedbackPath = path.join(changeRoot, 'feedback.yaml');
  const feedbackDoc = safeReadYaml(feedbackPath) as { entries?: any[] } | null;
  const openFeedback = feedbackDoc?.entries?.find((e: any) => e.status === 'open');

  if (openFeedback) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions:
          `An open feedback entry exists from ${openFeedback.from_stage} to ${openFeedback.to_stage}. ` +
          `Reason: ${openFeedback.reason}. ` +
          `Run scripts/sdlc.js ${openFeedback.to_stage} --dir ${changeDir} to fix the issue and re-review. ` +
          `Once accepted, run: sdlc feedback --dir ${changeDir} --resolve ${openFeedback.id}`,
        data: {
          change_dir: changeDir,
          change_root: changeRoot,
          pipeline,
          current_workflow: openFeedback.to_stage,
          suggested_command: `sdlc ${openFeedback.to_stage} --dir ${changeDir}`,
          open_feedback: openFeedback,
        },
        errors: [],
        warnings: [],
      } as Record<string, unknown>,
      EXIT.ok
    );
    return;
  }

  let currentWorkflow: string | undefined;
  let state: string = 'in_progress';
  let instructions: string = '';
  let suggestedCommand: string | null = null;

  // 1. Check for rejected stages first.
  const rejectedStage = order.find((key: string) => pipeline[key] === 'rejected');
  if (rejectedStage) {
    currentWorkflow = rejectedStage;
    state = 'blocked';
    instructions = `The ${rejectedStage} workflow has a rejected artifact. Fix the findings and review again.`;
    suggestedCommand = `sdlc ${rejectedStage} --dir ${changeDir}`;
  } else {
    // 2. Find the first incomplete stage whose gate is satisfied.
    for (const id of order) {
      const stage = getStageById(cwd, id);
      if (!stage) continue;

      const status = pipeline[id];
      const isDone =
        stage.kind === 'aggregator' ? status === 'complete' : status === 'accepted';

      if (isDone) continue;

      // A stage is runnable only when its acceptance gate is satisfied.
      const gate = evaluateGate(stage, changeRoot, cwd);
      if (!gate.satisfied) continue;

      currentWorkflow = id;

      if (stage.kind === 'review') {
        currentWorkflow = id;
        suggestedCommand = `sdlc ${id} --dir ${changeDir}`;
        instructions = `${stage.title} gate is ready. Run the review gate.`;
      } else if (status === 'ready-for-review') {
        const reviewStageId = `${id}-review`;
        currentWorkflow = reviewStageId;
        suggestedCommand = `sdlc ${reviewStageId} --dir ${changeDir}`;
        instructions = `${stage.title} is ready for review. Run the review gate.`;
      } else {
        currentWorkflow = id;
        suggestedCommand = `sdlc ${id} --dir ${changeDir}`;
        instructions = `${stage.title} is not accepted yet. Continue the ${id} stage.`;
      }

      state = status === 'blocked' ? 'blocked' : 'in_progress';
      break;
    }
  }

  // 3. All stages complete.
  if (!currentWorkflow) {
    currentWorkflow = 'complete';
    suggestedCommand = null;
    instructions = 'The full SDLC pipeline is complete for this change.';
    state = 'complete';
  }

  writeJson(
    {
      ...base,
      state,
      instructions,
      data: {
        change_dir: changeDir,
        change_root: changeRoot,
        pipeline,
        current_workflow: currentWorkflow,
        suggested_command: suggestedCommand,
      },
      errors: [],
      warnings: [],
    } as Record<string, unknown>,
    EXIT.ok
  );
}
