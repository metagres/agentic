import path from 'node:path';

import type { ParseArgsResult, WarningItem } from '../lib/types.ts';
import { parseArgs, writeJson, EXIT } from '../lib/cli.ts';
import { writeYamlAtomic } from '../lib/yaml-io.ts';
import { safeReadYaml } from '../lib/context.ts';
import { requireChangeRoot } from '../lib/change-root.ts';
import { today } from '../lib/ids.ts';
import { makeError } from '../lib/error-catalog.ts';
import { getStagesWithDelta } from '../lib/pipeline.ts';

function usage(code = EXIT.ok) {
  writeJson(
    {
      workflow: 'knowledge-extraction',
      step: 'help',
      state: code === EXIT.ok ? 'ok' : 'blocked',
      instructions:
        'Usage: sdlc knowledge-extraction --dir <change-dir> [--complete]',
      data: {},
      errors: [],
      warnings: [],
    },
    code
  );
}

export function runKnowledgeExtraction(argv: string[]) {
  const args = parseArgs(argv) as ParseArgsResult;

  if (args.help) {
    usage(EXIT.ok);
    return;
  }

  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
  const base: Record<string, unknown> = {
    workflow: 'knowledge-extraction',
    step: 'docs_delta',
  };

  const changeRoot = requireChangeRoot(args, cwd, base);
  if (!changeRoot) return;

  try {
    const warnings: WarningItem[] = [];
    const collectedDeltas: Record<string, unknown>[] = [];

    // Collect deltas from all stage artifacts
    const stageArtifacts = getStagesWithDelta(cwd).map(s => ({ file: s.file, stage: s.stage }));

    for (const cfg of stageArtifacts) {
      const artifactPath = path.join(changeRoot, cfg.file);
      const artifact = safeReadYaml(artifactPath) as Record<string, unknown> | null;

      if (artifact && Array.isArray(artifact.delta)) {
        (artifact.delta as Record<string, unknown>[]).forEach((delta) => {
          collectedDeltas.push({
            ...delta,
            source_stage: cfg.stage,
            source_artifact: cfg.file,
          });
        });
      }
    }

    const plan = safeReadYaml(path.join(changeRoot, 'plan.yaml')) as Record<string, unknown> | null;
    const implementationStatus = (plan?.metadata as Record<string, unknown>)?.implementation_status as string | null || null;
    const implementationOk = !plan || implementationStatus === 'accepted';

    if (plan && !implementationOk) {
      warnings.push({
        code: 'IMPLEMENTATION_NOT_ACCEPTED',
        message: 'plan.yaml implementation_status is not accepted. Complete implementation review before finalizing knowledge extraction.',
      });
    }

    const docsDeltaPath = path.join(changeRoot, 'docs-delta.yaml');

    if (args.complete) {
      if (!implementationOk) {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions: 'Knowledge extraction cannot be completed. Implementation review must be accepted first.',
            data: { change_root: changeRoot, implementation_status: implementationStatus },
            errors: [makeError('IMPLEMENTATION_NOT_ACCEPTED')],
            warnings,
          },
          EXIT.actionFailed
        );
        return;
      }

      const doc = {
        metadata: {
          stage: 'knowledge-extraction',
          status: 'complete',
          updated: today(),
          change_root: changeRoot,
        },
        deltas_applied: collectedDeltas.length,
      };

      writeYamlAtomic(docsDeltaPath, doc);

      writeJson(
        {
          ...base,
          state: 'complete',
          instructions: 'Documentation synchronization is complete.',
          data: { change_root: changeRoot, docs_delta: docsDeltaPath, status: 'complete' },
          errors: [],
          warnings,
        },
        EXIT.ok
      );
      return;
    }

    // Default behavior: list deltas to apply
    writeJson(
      {
        ...base,
        state: collectedDeltas.length > 0 ? 'in_progress' : 'complete',
        instructions: 
          'Update docs/current according to the deltas listed in data.deltas_to_apply. ' +
          'After updating the docs, run: sdlc knowledge-extraction --dir <change-dir> --complete',
        data: {
          change_root: changeRoot,
          deltas_to_apply: collectedDeltas,
          implementation_status: implementationStatus,
        },
        errors: [],
        warnings,
      },
      EXIT.ok
    );
  } catch (err: unknown) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions: err instanceof Error ? err.message : String(err),
        data: { change_root: changeRoot },
        errors: [makeError('INTERNAL_ERROR', { message: err instanceof Error ? err.message : String(err) })],
        warnings: [],
      },
      EXIT.internal
    );
  }
}