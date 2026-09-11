import path from 'node:path';

import { parseArgs, writeJson, EXIT, resolveCwd, CWD_FLAG_DOC } from '../lib/cli.ts';
import { safeReadYaml } from '../lib/context.ts';
import { requireChangeRoot } from '../lib/change-root.ts';
import { getStageById } from '../lib/stage-registry.ts';
import { computePipelineOrder, evaluateGate } from '../lib/requires-graph.ts';
import { helpEnvelope, rejectUnknownFlags, STATUS_FLAGS } from '../lib/help.ts';
import type { ParseArgsResult } from '../lib/types.ts';

function usage(code: number = EXIT.ok): void {
  if (code === EXIT.ok) {
    writeJson(
      helpEnvelope({
        command: 'status',
        purpose: 'Show the pipeline state for one change and the suggested next command.',
        usage: ['sdlc status --change <change-name>'],
        flags: STATUS_FLAGS,
      }),
      code
    );
    return;
  }

  writeJson(
    {
      command: 'status',
      step: 'help',
      state: 'blocked',
      instructions: 'Usage: sdlc status --change <change-name> ' + CWD_FLAG_DOC,
      data: {},
      errors: [],
      warnings: [],
    },
    code
  );
}

// The tracked artifact of a review stage is the artifact of the stage it
// reviews; for every other stage it is its own artifact (DEC-008). Exported
// for the read-only changes inventory (FR-004).
export function trackedStage(cwd: string, stageId: string) {
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

export { readStageStatus };

export function runStatus(argv: string[]): void {
  const args = parseArgs(argv) as ParseArgsResult;
  rejectUnknownFlags('status', args, STATUS_FLAGS);

  if (args.help) {
    usage(EXIT.ok);
    return;
  }

  const cwd = resolveCwd(args);

  const base: Record<string, unknown> = {
    command: 'status',
    step: 'pipeline',
  };

  const changeRoot = requireChangeRoot(args, cwd, base);
  if (!changeRoot) return;
  const changeDir = path.basename(changeRoot);

  // Pipeline order derives from the requires DAG with an alphabetical
  // tie-break; no hardcoded pipeline map exists anymore.
  const order = computePipelineOrder(cwd);

  const statuses: Record<string, string> = {};
  for (const id of order) {
    statuses[id] = readStageStatus(cwd, changeRoot, id);
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
          `Run sdlc ${openFeedback.to_stage} --change ${changeDir} to fix the issue and re-review. ` +
          `Once accepted, run: sdlc feedback --change ${changeDir} --resolve ${openFeedback.id}`,
        data: {
          change_name: changeDir,
          stage: openFeedback.to_stage,
          agent: getStageById(cwd, openFeedback.to_stage)?.agent ?? null,
          suggested_command: `sdlc ${openFeedback.to_stage} --change ${changeDir}`,
          open_feedback: openFeedback,
        },
        errors: [],
        warnings: [],
      } as Record<string, unknown>,
      EXIT.ok
    );
    return;
  }

  let stage: string | undefined;
  let state: string = 'in_progress';
  let instructions: string = '';
  let suggestedCommand: string | null = null;

  // 1. Check for rejected stages first.
  const rejectedStage = order.find((key: string) => statuses[key] === 'rejected');
  if (rejectedStage) {
    stage = rejectedStage;
    state = 'blocked';
    instructions = `The ${rejectedStage} stage has a rejected artifact. Fix the recorded failures and re-finalize.`;
    suggestedCommand = `sdlc ${rejectedStage} --change ${changeDir}`;
  } else {
    // 2. Find the first incomplete stage whose gate is satisfied.
    for (const id of order) {
      const stageRecord = getStageById(cwd, id);
      if (!stageRecord) continue;

      const status = statuses[id];
      const isDone =
        stageRecord.kind === 'aggregator' ? status === 'complete' : status === 'accepted';

      if (isDone) continue;

      // A stage is runnable only when its acceptance gate is satisfied.
      const gate = evaluateGate(stageRecord, changeRoot, cwd);
      if (!gate.satisfied) continue;

      if (stageRecord.kind === 'review') {
        stage = id;
        suggestedCommand = `sdlc ${id} --change ${changeDir}`;
        instructions = `${stageRecord.title} gate is ready. Run the review gate.`;
      } else if (status === 'ready-for-review') {
        const reviewStageId = `${id}-review`;
        stage = reviewStageId;
        suggestedCommand = `sdlc ${reviewStageId} --change ${changeDir}`;
        instructions = `${stageRecord.title} is ready for review. Run the review gate.`;
      } else {
        stage = id;
        suggestedCommand = `sdlc ${id} --change ${changeDir}`;
        instructions = `${stageRecord.title} is not accepted yet. Continue the ${id} stage.`;
      }

      state = status === 'blocked' ? 'blocked' : 'in_progress';
      break;
    }
  }

  // 3. All stages complete.
  if (!stage) {
    stage = 'complete';
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
        change_name: changeDir,
        stage,
        agent: stage === 'complete' ? null : getStageById(cwd, stage)?.agent ?? null,
        suggested_command: suggestedCommand,
      },
      errors: [],
      warnings: [],
    } as Record<string, unknown>,
    EXIT.ok
  );
}
