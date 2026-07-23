import path from 'node:path';

import { parseArgs, writeJson, EXIT } from '../lib/cli.mjs';
import { safeReadYaml } from '../lib/context.mjs';
import { requireChangeRoot } from '../lib/change-root.mjs';

function usage(code = EXIT.ok) {
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

export function runStatus(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    usage(EXIT.ok);
    return;
  }

  const cwd = args.cwd
    ? path.resolve(String(args.cwd))
    : process.cwd();

  const base = {
    workflow: 'status',
    step: 'pipeline',
  };

  const changeRoot = requireChangeRoot(args, cwd, base);
  if (!changeRoot) return;
  const changeDir = path.basename(changeRoot);

  const requirements = safeReadYaml(
    path.join(changeRoot, 'requirements.yaml')
  );

  const design = safeReadYaml(path.join(changeRoot, 'design.yaml'));

  const plan = safeReadYaml(path.join(changeRoot, 'plan.yaml'));

  const docsDelta = safeReadYaml(path.join(changeRoot, 'docs-delta.yaml'));

  const requirementsStatus =
    requirements?.metadata?.status ||
    (requirements ? 'draft' : 'missing');

  const designStatus =
    design?.metadata?.status ||
    (design ? 'draft' : 'missing');

  const planningStatus =
    plan?.metadata?.status ||
    (plan ? 'draft' : 'missing');

  const implementationStatus =
    plan?.metadata?.implementation_status ||
    (plan ? 'pending' : 'missing');

  const knowledgeStatus =
    docsDelta?.metadata?.status ||
    (docsDelta ? 'pending' : 'missing');

  const pipeline = {
    requirements: requirementsStatus,
    design: designStatus,
    planning: planningStatus,
    implementation: implementationStatus,
    'knowledge-extraction': knowledgeStatus,
  };

  const order = [
    'requirements',
    'design',
    'planning',
    'implementation',
    'knowledge-extraction',
  ];

  const rejected = order.find((key) => pipeline[key] === 'rejected');

  let currentWorkflow;
  let state;
  let instructions;
  let suggestedCommand = null;

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
    },
    EXIT.ok
  );
}
