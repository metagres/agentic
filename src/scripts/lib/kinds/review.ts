import path from 'node:path';

import type { StageRecord } from '../stage-registry.ts';
import { getStageById } from '../stage-registry.ts';
import { parseArgs, writeJson, EXIT, CWD_FLAG_DOC } from '../cli.ts';
import { writeYamlAtomic, readYaml } from '../yaml-io.ts';
import { safeReadYaml } from '../context.ts';
import { resolveRootOrError, ResolveRootError } from '../resolve-root.ts';
import { today, nowIso } from '../ids.ts';
import { validateArtifact } from '../validate.ts';
import { evaluateGate } from '../requires-graph.ts';
import { makeError } from '../error-catalog.ts';
import type { WarningItem, Finding } from '../types.ts';

export interface ReviewRunOptions {
  // Legacy 'review --target X' interim routing (TASK-008): report workflow
  // 'review' and data.target as the original target label.
  workflowLabel?: string;
  targetLabel?: string;
}

function semanticChecksFor(stage: StageRecord): string[] {
  if (!stage.files.semanticChecks) return [];
  const doc = readYaml(stage.files.semanticChecks) as { checks?: unknown } | null;
  return Array.isArray(doc?.checks)
    ? (doc.checks as unknown[]).filter((c) => typeof c === 'string') as string[]
    : [];
}

function blockingFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => !f.severity || f.severity === 'blocking');
}

export async function runReviewStage(
  stage: StageRecord,
  argv: string[],
  cwd: string,
  options: ReviewRunOptions = {}
): Promise<void> {
  const args = parseArgs(argv);
  const workflow = options.workflowLabel || stage.id;
  const targetStage = stage.reviews ? getStageById(cwd, stage.reviews) : null;
  const targetLabel = options.targetLabel || stage.reviews || stage.id;

  const usage = (code: number, message: string | null = null) => {
    const instructions =
      options.workflowLabel === 'review'
        ? 'Usage: sdlc review --target <requirements|design|plan|implementation> --change <change-name> [--accept|--reject] [--dry-run] ' +
          CWD_FLAG_DOC
        : `Usage: sdlc ${stage.id} --change <change-name> [--accept|--reject] [--dry-run] ` +
          CWD_FLAG_DOC;
    writeJson(
      {
        workflow,
        step: 'help',
        state: code === EXIT.ok ? 'ok' : 'blocked',
        instructions,
        data: {
          ...(targetStage ? { reviews: targetStage.id } : {}),
          known_targets: options.workflowLabel === 'review' ? ['requirements', 'design', 'plan', 'implementation'] : undefined,
        },
        errors:
          code === EXIT.ok
            ? []
            : [
                makeError('USAGE', {
                  message:
                    message ||
                    (options.workflowLabel === 'review'
                      ? 'review requires --target <requirements|design|plan|implementation> and --change <change-name>'
                      : `review requires --change <change-name>`),
                }),
              ],
        warnings: [],
      },
      code
    );
  };

  if (args.help) {
    usage(EXIT.ok);
    return;
  }

  // Interim routing: the dedicated review command requires --target.
  if (options.workflowLabel === 'review' && !args.target) {
    usage(EXIT.usage);
    return;
  }

  if (!args.change) {
    writeJson(
      {
        workflow,
        step: 'review',
        state: 'blocked',
        instructions: 'Provide --change <change-name>.',
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
        },
        errors: [makeError('MISSING_CHANGE_DIR')],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  let changeRoot: string;
  try {
    changeRoot = resolveRootOrError(String(args.change), { cwd });
  } catch (err: unknown) {
    if (err instanceof ResolveRootError) {
      writeJson(
        {
          workflow,
          step: 'review',
          state: 'blocked',
          instructions: err.message,
          data: {
            target: targetLabel,
            target_artifact: stage.artifact,
            candidates: err.candidates || [],
            available_changes: err.available || [],
            searched: err.searched || undefined,
          },
          errors: [
            makeError(
              err.candidates && err.candidates.length > 0
                ? 'AMBIGUOUS_CHANGE_DIR'
                : 'CHANGE_DIR_NOT_FOUND',
              {
                message: err.message,
                candidates: err.candidates || [],
                ...(err.available.length > 0
                  ? { fix: 'Use one of data.available_changes as --change (the exact name or a unique part of it).' }
                  : {}),
              }
            ),
          ],
          warnings: [],
        },
        EXIT.ambiguous
      );
      return;
    }
    throw err;
  }

  if (args.accept && args.reject) {
    writeJson(
      {
        workflow,
        step: 'review',
        state: 'blocked',
        instructions: 'Use either --accept or --reject, not both.',
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
          change_root: changeRoot,
        },
        errors: [makeError('CONFLICTING_DECISION')],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  try {
    // Review gate (DEC-008): the tracked artifact must be ready-for-review or
    // accepted.
    const gate = evaluateGate(stage, changeRoot, cwd);
    if (!gate.satisfied) {
      writeJson(
        {
          workflow,
          step: 'review',
          state: 'blocked',
          instructions:
            'The review gate is not satisfied:\n - ' +
            gate.unsatisfied
              .map((u) => `${u.stage} (${u.artifact} status '${u.status}', required ${u.required})`)
              .join('\n - '),
          data: {
            target: targetLabel,
            target_artifact: stage.artifact,
            change_root: changeRoot,
            unsatisfied_requirements: gate.unsatisfied,
          },
          errors: [makeError('STAGE_GATE_BLOCKED', { message: 'Tracked artifact is not ready for review.' })],
          warnings: [],
        },
        EXIT.actionFailed
      );
      return;
    }

    const trackedStage = targetStage || stage;
    const artifactPath = path.join(changeRoot, trackedStage.artifact);
    const artifact = safeReadYaml(artifactPath) as Record<string, unknown> | null;

    if (!artifact) {
      writeJson(
        {
          workflow,
          step: 'review',
          state: 'blocked',
          instructions: `No ${trackedStage.artifact} found in ${changeRoot}. Run the relevant stage first.`,
          data: {
            target: targetLabel,
            target_artifact: trackedStage.artifact,
            artifact: artifactPath,
            change_root: changeRoot,
          },
          errors: [
            makeError('ARTIFACT_NOT_FOUND', {
              message: `No ${trackedStage.artifact} found in ${changeRoot}.`,
            }),
          ],
          warnings: [],
        },
        EXIT.actionFailed
      );
      return;
    }

    const warnings: WarningItem[] = [];

    // Unified validation path: identical findings to internal finalize (FR-006).
    const findings = validateArtifact(trackedStage.id, artifact, cwd, changeRoot);
    const blocking = blockingFindings(findings);

    const metadata = (artifact.metadata as Record<string, unknown>) || {};
    const currentStatus = String(metadata[trackedStage.statusField] || '');
    const readyForReview =
      currentStatus === 'ready-for-review' || currentStatus === 'accepted';

    const stageChecks = semanticChecksFor(trackedStage);

    const canAccept = readyForReview && blocking.length === 0;

    let decision = 'review';
    let state: string = canAccept ? 'ok' : 'blocked';
    let instructions = '';
    const errors: { code: string; message: string }[] = [];
    const dryRun = Boolean(args['dry-run']);
    const shouldRecord = !dryRun;

    if (args.accept) {
      decision = canAccept ? 'accepted' : 'accept_blocked';

      if (canAccept) {
        if (!dryRun) {
          metadata[trackedStage.statusField] = 'accepted';
          metadata.updated = today();
          writeYamlAtomic(artifactPath, artifact);
        }

        state = 'complete';
        instructions = `The ${trackedStage.id} review was accepted. The artifact status is now 'accepted'.`;
        if (dryRun) instructions += ' Dry run: no changes were written.';
      } else {
        state = 'blocked';
        instructions = `The ${trackedStage.id} artifact cannot be accepted yet. It must be ready-for-review and have no blocking structural/reference findings.`;
        errors.push(
          makeError('CANNOT_ACCEPT', {
            message: `ready_for_review=${readyForReview}, blocking=${blocking.length}`,
          })
        );
      }
    } else if (args.reject) {
      decision = 'rejected';

      if (!dryRun) {
        metadata[trackedStage.statusField] = 'rejected';
        metadata.updated = today();
        writeYamlAtomic(artifactPath, artifact);
      }

      state = 'blocked';
      instructions = `The ${trackedStage.id} review was rejected. Run the corresponding authoring or implementation workflow to fix the findings, then review again.`;
      if (dryRun) instructions += ' Dry run: no changes were written.';
    } else {
      instructions = canAccept
        ? `The ${trackedStage.id} artifact passed structural validation. Please review the following semantic checks:\n\n${stageChecks
            .map((c, i) => `${i + 1}. ${c}`)
            .join('\n')}\n\nIf all pass, accept with --accept.`
        : `The ${trackedStage.id} artifact cannot be accepted yet. Fix the blocking findings and review again.`;

      if (dryRun) instructions += ' Dry run: no changes were written.';

      if (!canAccept) {
        errors.push(
          makeError('REVIEW_NOT_PASSING', {
            message: `ready_for_review=${readyForReview}, blocking=${blocking.length}`,
          })
        );
      }
    }

    const reviewPath = path.join(changeRoot, stage.reviewFile || `${stage.id}.yaml`);
    const reviewDoc: Record<string, unknown> =
      (safeReadYaml(reviewPath) as Record<string, unknown> | null) || {
        metadata: {
          artifact: trackedStage.artifact,
          target: trackedStage.id,
          latest_round: 0,
          created: today(),
          updated: today(),
        },
        rounds: [],
      };

    if (!Array.isArray(reviewDoc.rounds)) {
      reviewDoc.rounds = [];
    }

    const roundsArr = reviewDoc.rounds as unknown[];
    const roundNumber = roundsArr.length + 1;
    let recordedRound: number | null = null;
    const recordRound =
      shouldRecord &&
      !(args.reject && errors.some((e) => e.code === 'ILLEGAL_STATUS_TRANSITION'));

    if (recordRound) {
      const round = {
        round: roundNumber,
        reviewed_at: nowIso(),
        artifact_version: metadata.version || null,
        ...(trackedStage.statusField === 'implementation_status'
          ? {
              implementation_status: metadata.implementation_status || null,
            }
          : {}),
        decision,
        can_accept: canAccept,
        mechanical: {
          valid: blocking.length === 0,
          blocking_count: blocking.length,
          findings,
        },
        warnings: blocking.filter((f) => f.severity !== 'blocking'),
      };

      (reviewDoc.rounds as unknown[]).push(round);
      reviewDoc.metadata = {
        ...(reviewDoc.metadata as Record<string, unknown>),
        artifact: trackedStage.artifact,
        target: trackedStage.id,
        latest_round: roundNumber,
        latest_decision: decision,
        updated: today(),
      };

      writeYamlAtomic(reviewPath, reviewDoc);
      recordedRound = roundNumber;
    }

    writeJson(
      {
        workflow,
        step: 'review',
        state,
        instructions,
        data: {
          target: targetLabel,
          target_artifact: trackedStage.artifact,
          artifact: artifactPath,
          change_root: changeRoot,
          review_file: reviewPath,
          decision,
          can_accept: canAccept,
          dry_run: dryRun,
          artifact_status: metadata[trackedStage.statusField] as string | null || null,
          blocking_count: blocking.length,
          blocking_findings: blocking,
          round: recordedRound,
        },
        errors,
        warnings: blocking
          .filter((f) => f.severity !== 'blocking')
          .map((f) => ({ code: 'VALIDATION_WARNING', message: f.finding })),
      },
      EXIT.ok
    );
  } catch (err: unknown) {
    writeJson(
      {
        workflow,
        step: 'review',
        state: 'blocked',
        instructions: err instanceof Error ? err.message : String(err),
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
          change_root: changeRoot,
        },
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

/**
 * Interim entry for the dedicated review command (TASK-008): --target maps to
 * the <target>-review stage until TASK-009 removes the command.
 */
export function reviewTargetToStageId(target: string | null | undefined): string | null {
  if (!target) return null;
  const normalized = String(target).replace(/\.yaml$/, '');
  const aliases: Record<string, string> = {
    plan: 'planning',
  };
  const stageId = aliases[normalized] || normalized;
  return `${stageId}-review`;
}
