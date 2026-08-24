import path from 'node:path';

import { writeJson, EXIT, parseArgs } from './cli.ts';
import { getStageById } from './stage-registry.ts';
import { runStage } from './kinds/index.ts';

/**
 * Entry for the authoring-style stages. The hardcoded per-stage map is gone:
 * the stage is resolved from the registry by id and dispatched to its kind
 * interpreter, which is always authoring for the migrated authoring stages.
 */
export async function runAuthoringStage(stageId: string, argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
  const stage = getStageById(cwd, stageId);

  if (!stage) {
    writeJson(
      {
        workflow: stageId,
        step: 'blocked',
        state: 'blocked',
        instructions: `Unknown stage: ${stageId}.`,
        data: {},
        errors: [{ code: 'UNKNOWN_STAGE', message: `Unknown stage: ${stageId}` }],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  await runStage(stage, argv, cwd);
}
