import path from 'node:path';

import { parseArgs, writeJson, EXIT } from '../lib/cli.ts';
import { safeReadYaml } from '../lib/context.ts';
import { requireChangeRoot } from '../lib/change-root.ts';
// sdlc-hardening: pipeline
import { loadPipeline } from '../lib/policy-loader.ts';
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

export function runStatus(argv: string[]): void {
  const args = parseArgs(argv) as ParseArgsResult;

  if (args.help) {
    usage(EXIT.ok);
    return;
  }

  const cwd = args.cwd
    ? path.resolve(String(args.cwd))
    : process.cwd();

  const base: Record<string, unknown> = {
    workflow: 'status',
    step: 'pipeline',
  };

  const changeRoot = requireChangeRoot(args, cwd, base);
  if (!changeRoot) return;
  const changeDir = path.basename(changeRoot);

  const requirements = safeReadYaml(
    path.join(changeRoot, 'requirements.yaml')
  ) as Record<string, unknown> | null;

  const design = safeReadYaml(path.join(changeRoot, 'design.yaml')) as Record<string, unknown> | null;

  const plan = safeReadYaml(path.join(changeRoot, 'plan.yaml')) as Record<string, unknown> | null;

  const docsDelta = safeReadYaml(path.join(changeRoot, 'docs-delta.yaml')) as Record<string, unknown> | null;

  const getMeta = (obj: Record<string, unknown> | null): Record<string, unknown> | undefined =>
    obj?.metadata as Record<string, unknown> | undefined;

  const requirementsMeta = getMeta(requirements);
  const designMeta = getMeta(design);
  const planMeta = getMeta(plan);
  const docsDeltaMeta = getMeta(docsDelta);

  const requirementsStatus: string =
    requirementsMeta?.status as string ||
    (requirements ? 'draft' : 'missing');

  const designStatus: string =
    designMeta?.status as string ||
    (design ? 'draft' : 'missing');

  const planningStatus: string =
    planMeta?.status as string ||
    (plan ? 'draft' : 'missing');

  const implementationStatus: string =
    (planMeta?.implementation_status as string) ||
    (plan ? 'pending' : 'missing');

  const knowledgeStatus: string =
    docsDeltaMeta?.status as string ||
    (docsDelta ? 'pending' : 'missing');

  const pipeline: Record<string, string> = {
    requirements: requirementsStatus,
    design: designStatus,
    planning: planningStatus,
    implementation: implementationStatus,
    'knowledge-extraction': knowledgeStatus,
  };

  let order: string[];
  try {
    const pipelineData = loadPipeline(cwd) as Record<string, unknown> | null;
    const stages = pipelineData?.stages as Record<string, unknown> | undefined;
    order = Object.keys(stages || {});
  } catch {
    order = [];
  }

  if (!Array.isArray(order) || order.length === 0) {
    order = [
      'requirements',
      'design',
      'planning',
      'implementation',
      'knowledge-extraction',
    ];
  }

    // Check for open feedback first
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
          `Please switch to the ${openFeedback.to_stage}-authoring skill, fix the issue, and re-review. ` +
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

  const stageStatuses: Record<string, string> = {
    'requirements': requirementsStatus,
    'design': designStatus,
    'planning': planningStatus,
    'implementation': implementationStatus,
    'knowledge-extraction': knowledgeStatus,
  };

  let currentWorkflow: string | undefined;
  let state: string = 'in_progress';
  let instructions: string = '';
  let suggestedCommand: string | null = null;

  // 1. Check for rejected stages first
  const rejectedStage = order.find((key: string) => stageStatuses[key] === 'rejected');
  if (rejectedStage) {
    currentWorkflow = rejectedStage;
    state = 'blocked';
    instructions = `The ${rejectedStage} workflow has a rejected artifact. Fix the findings and review again.`;
    suggestedCommand = `sdlc ${rejectedStage} --dir ${changeDir}`;
  } else {
    // 2. Find the first incomplete stage
    for (const stage of order) {
      const status = stageStatuses[stage];
      const isDone = stage === 'knowledge-extraction' ? status === 'complete' : status === 'accepted';

      if (!isDone) {
        currentWorkflow = stage;
        const target = stage === 'planning' ? 'plan' : stage;

        if (status === 'ready-for-review') {
          currentWorkflow = 'review';
          suggestedCommand = `sdlc review --target ${target} --dir ${changeDir}`;
          instructions = `${stage.charAt(0).toUpperCase() + stage.slice(1)} is ready for review. Run the review gate.`;
        } else {
          suggestedCommand = `sdlc ${stage} --dir ${changeDir}`;
          instructions = `${stage.charAt(0).toUpperCase() + stage.slice(1)} is not accepted yet. Continue the ${stage} stage.`;
        }

        state = status === 'blocked' ? 'blocked' : 'in_progress';
        break; // Stop at the first non-done stage
      }
    }
  }

  // 3. If loop finishes and all are done
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
