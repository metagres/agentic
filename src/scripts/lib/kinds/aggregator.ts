import fs from 'node:fs';
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

/**
 * Anchor identity of a delta entry: its target_anchor when present, otherwise
 * its entity_id. Entries without either carry no identity (null) and merge
 * freely with any other entry in their target_doc + change group.
 */
function deltaAnchorIdentity(delta: Record<string, unknown>): string | null {
  if (delta.target_anchor !== undefined && delta.target_anchor !== null && String(delta.target_anchor).length > 0) {
    return `anchor:${String(delta.target_anchor)}`;
  }
  if (delta.entity_id !== undefined && delta.entity_id !== null && String(delta.entity_id).length > 0) {
    return `entity:${String(delta.entity_id)}`;
  }
  return null;
}

/**
 * Deduplicates collected deltas before they are presented as deltas_to_apply.
 * Entries are grouped by target_doc + change (different change types on the
 * same doc stay separate). Within a group the latest entry wins — entry order
 * follows artifact/phase collection order, so later phases overwrite earlier
 * ones — unless the group carries distinct non-null anchors that cannot be
 * merged: those anchored edits are kept as separate entries (conservative:
 * never drop a distinct anchored edit). Output is sorted by target_doc, then
 * change, then phase so presentation is deterministic.
 */
export function dedupeDeltas(
  deltas: Record<string, unknown>[]
): Record<string, unknown>[] {
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const delta of deltas) {
    const key = `${String(delta.target_doc ?? '')}\u0000${String(delta.change ?? '')}`;
    const group = groups.get(key);
    if (group) {
      group.push(delta);
    } else {
      groups.set(key, [delta]);
    }
  }

  const result: Record<string, unknown>[] = [];

  for (const group of groups.values()) {
    const identities = new Set(
      group
        .map((d) => deltaAnchorIdentity(d))
        .filter((id): id is string => id !== null)
    );

    if (identities.size <= 1) {
      // Anchors overlap or are absent: one edit target — keep the latest.
      result.push(group[group.length - 1]);
      continue;
    }

    // Distinct non-null anchors cannot be merged: keep the latest entry per
    // anchor identity plus the latest unanchored entry, if any.
    const latestPerIdentity = new Map<string, Record<string, unknown>>();
    let latestUnanchored: Record<string, unknown> | null = null;

    for (const delta of group) {
      const identity = deltaAnchorIdentity(delta);
      if (identity === null) {
        latestUnanchored = delta;
      } else {
        latestPerIdentity.set(identity, delta);
      }
    }

    if (latestUnanchored) result.push(latestUnanchored);
    for (const delta of latestPerIdentity.values()) result.push(delta);
  }

  return result.sort((a, b) => {
    const byDoc = String(a.target_doc ?? '').localeCompare(String(b.target_doc ?? ''));
    if (byDoc !== 0) return byDoc;
    const byChange = String(a.change ?? '').localeCompare(String(b.change ?? ''));
    if (byChange !== 0) return byChange;
    return String(a.phase ?? '').localeCompare(String(b.phase ?? ''));
  });
}

function usage(stage: StageRecord, code = EXIT.ok) {
  writeJson(
    {
      workflow: stage.id,
      step: 'help',
      state: code === EXIT.ok ? 'ok' : 'blocked',
      instructions: `Usage: sdlc ${stage.id} --change <change-name> [--complete]`,
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

    // The CLI never creates docs/current (DEC-002): when the target project
    // has no docs index, warn on both the delta-listing and --complete paths
    // and name the knowledge-init skill as the sole creator.
    const docsIndexPath = path.join(cwd, 'docs', 'current', 'index.md');
    if (!fs.existsSync(docsIndexPath)) {
      warnings.push(makeError('DOCS_INDEX_MISSING'));
    }

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

    // Near-duplicate entries across phases (same target_doc + change) are
    // collapsed before presentation; distinct anchored edits survive.
    const deltasToApply = dedupeDeltas(collectedDeltas);

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
        deltas_applied: deltasToApply.length,
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
        state: deltasToApply.length > 0 ? 'in_progress' : 'complete',
        instructions:
          'Update docs/current according to the deltas listed in data.deltas_to_apply. ' +
          `After updating the docs, run: sdlc ${stage.id} --change <change-name> --complete`,
        data: {
          change_root: changeRoot,
          deltas_to_apply: deltasToApply,
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
