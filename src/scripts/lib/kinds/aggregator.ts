import path from 'node:path';

import type { StageRecord } from '../stage-registry.ts';
import { loadStageRegistry } from '../stage-registry.ts';
import { parseArgs, writeJson, EXIT } from '../cli.ts';
import { writeYamlAtomic } from '../yaml-io.ts';
import { safeReadYaml } from '../context.ts';
import { requireChangeRoot } from '../change-root.ts';
import { today } from '../ids.ts';
import { makeError } from '../error-catalog.ts';
import { evaluateGate } from '../requires-graph.ts';
import type { ParseArgsResult, WarningItem } from '../types.ts';

function usage(stage: StageRecord, code = EXIT.ok) {
  writeJson(
    {
      workflow: stage.id,
      step: 'help',
      state: code === EXIT.ok ? 'ok' : 'blocked',
      instructions: `Usage: sdlc ${stage.id} --dir <change-dir> [--complete]`,
      data: {},
      errors: [],
      warnings: [],
    },
    code
  );
}

export async function runAggregatorStage(
  stage: StageRecord,
  argv: string[],
  cwd: string
): Promise<void> {
  const args = parseArgs(argv) as ParseArgsResult;

  if (args.help) {
    usage(stage, EXIT.ok);
    return;
  }

  const base: Record<string, unknown> = {
    workflow: stage.id,
    step: 'docs_delta',
  };

  const changeRoot = requireChangeRoot(args, cwd, base);
  if (!changeRoot) return;

  try {
    // Acceptance gate (DEC-008): knowledge extraction is runnable only when the
    // implementation stage's tracked artifact is accepted.
    const gate = evaluateGate(stage, changeRoot, cwd);
    if (!gate.satisfied) {
      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions:
            'This stage cannot run until every required stage is accepted:\n - ' +
            gate.unsatisfied
              .map((u) => `${u.stage} (${u.artifact} status '${u.status}', required ${u.required})`)
              .join('\n - '),
          data: {
            change_root: changeRoot,
            unsatisfied_requirements: gate.unsatisfied,
          },
          errors: [makeError('STAGE_GATE_BLOCKED', { message: 'Required stage is not accepted.' })],
          warnings: [],
        },
        EXIT.actionFailed
      );
      return;
    }

    const warnings: WarningItem[] = [];
    const collectedDeltas: Record<string, unknown>[] = [];

    // Collect deltas from all delta-producing stages in the registry.
    const deltaStages = loadStageRegistry(cwd).filter((s) => s.producesDelta);

    for (const cfg of deltaStages) {
      const artifactPath = path.join(changeRoot, cfg.artifact);
      const artifact = safeReadYaml(artifactPath) as Record<string, unknown> | null;

      if (artifact && Array.isArray(artifact.delta)) {
        (artifact.delta as Record<string, unknown>[]).forEach((delta) => {
          collectedDeltas.push({
            ...delta,
            source_stage: cfg.id,
            source_artifact: cfg.artifact,
          });
        });
      }
    }

    const plan = safeReadYaml(path.join(changeRoot, 'plan.yaml')) as Record<string, unknown> | null;
    const implementationStatus =
      (plan?.metadata as Record<string, unknown>)?.implementation_status as string | null || null;
    const implementationOk = !plan || implementationStatus === 'accepted';

    if (plan && !implementationOk) {
      warnings.push({
        code: 'IMPLEMENTATION_NOT_ACCEPTED',
        message:
          'plan.yaml implementation_status is not accepted. Complete implementation review before finalizing knowledge extraction.',
      });
    }

    const docsDeltaPath = path.join(changeRoot, 'docs-delta.yaml');

    if (args.complete) {
      if (!implementationOk) {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions:
              'Knowledge extraction cannot be completed. Implementation review must be accepted first.',
            data: {
              change_root: changeRoot,
              implementation_status: implementationStatus,
            },
            errors: [makeError('IMPLEMENTATION_NOT_ACCEPTED')],
            warnings,
          },
          EXIT.actionFailed
        );
        return;
      }

      const doc = {
        metadata: {
          stage: stage.id,
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
          data: {
            change_root: changeRoot,
            docs_delta: docsDeltaPath,
            status: 'complete',
          },
          errors: [],
          warnings,
        },
        EXIT.ok
      );
      return;
    }

    // Default behavior: list deltas to apply.
    writeJson(
      {
        ...base,
        state: collectedDeltas.length > 0 ? 'in_progress' : 'complete',
        instructions:
          'Update docs/current according to the deltas listed in data.deltas_to_apply. ' +
          `After updating the docs, run: sdlc ${stage.id} --dir <change-dir> --complete`,
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
        errors: [
          makeError('INTERNAL_ERROR', {
            message: err instanceof Error ? err.message : String(err),
          }),
        ],
        warnings: [],
      },
      EXIT.internal
    );
  }
}
