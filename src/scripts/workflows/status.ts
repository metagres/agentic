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

  const rejected = order.find((key: string) => pipeline[key] === 'rejected');

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

  let currentWorkflow: string | undefined;
  let state: string;
  let instructions: string;
  let suggestedCommand: string | null = null;

  if (rejected) {
    currentWorkflow = rejected;
    state = 'blocked';
    instructions =
      `The ${rejected} workflow has a rejected artifact. ` +
      'Fix the findings and review again.';

    if (rejected === 'implementation') {
      suggestedCommand = `sdlc implementation --dir ${changeDir}`;
    } else if (rejected === 'knowledge-extraction') {
      suggestedCommand = `sdlc knowledge-extraction --dir ${changeDir}`;
    } else {
      suggestedCommand = `sdlc ${rejected} --dir ${changeDir}`;
    }
  } else if (requirementsStatus !== 'accepted') {
    if (requirementsStatus === 'ready-for-review') {
      currentWorkflow = 'review';
      suggestedCommand = `sdlc review --target requirements --dir ${changeDir}`;
      instructions =
        'Requirements are ready for review. Run the requirements review gate.';
    } else {
      currentWorkflow = 'requirements';
      suggestedCommand = `sdlc requirements --dir ${changeDir}`;
      instructions =
        'Requirements are not accepted yet. Continue the requirements stage.';
    }

    state = requirementsStatus === 'blocked' ? 'blocked' : 'in_progress';
  } else if (designStatus !== 'accepted') {
    if (designStatus === 'ready-for-review') {
      currentWorkflow = 'review';
      suggestedCommand = `sdlc review --target design --dir ${changeDir}`;
      instructions = 'Design is ready for review. Run the design review gate.';
    } else {
      currentWorkflow = 'design';
      suggestedCommand = `sdlc design --dir ${changeDir}`;
      instructions = 'Design is not accepted yet. Continue the design stage.';
    }

    state = designStatus === 'blocked' ? 'blocked' : 'in_progress';
  } else if (planningStatus !== 'accepted') {
    if (planningStatus === 'ready-for-review') {
      currentWorkflow = 'review';
      suggestedCommand = `sdlc review --target plan --dir ${changeDir}`;
      instructions = 'Plan is ready for review. Run the plan review gate.';
    } else {
      currentWorkflow = 'planning';
      suggestedCommand = `sdlc planning --dir ${changeDir}`;
      instructions = 'Planning is not accepted yet. Continue the planning stage.';
    }

    state = planningStatus === 'blocked' ? 'blocked' : 'in_progress';
  } else if (implementationStatus !== 'accepted') {
    if (implementationStatus === 'ready-for-review') {
      currentWorkflow = 'review';
      suggestedCommand = `sdlc review --target implementation --dir ${changeDir}`;
      instructions =
        'Implementation is ready for review. Run the implementation review gate.';
    } else {
      currentWorkflow = 'implementation';
      suggestedCommand = `sdlc implementation --dir ${changeDir}`;
      instructions =
        'Implementation is not accepted yet. Continue updating task execution state.';
    }

    state = implementationStatus === 'blocked' ? 'blocked' : 'in_progress';
  } else if (knowledgeStatus !== 'complete') {
    currentWorkflow = 'knowledge-extraction';
    suggestedCommand = `sdlc knowledge-extraction --dir ${changeDir}`;
    instructions =
      'Implementation is accepted. Synchronize docs/current using knowledge extraction.';
    state = 'in_progress';
  } else {
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
