import path from 'node:path';
import fs from 'node:fs';

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
import {
  collectKnownIds,
  FindingsFileError,
  parseFindingsFile,
  resolveFindingTargets,
  validateSemanticWalk,
} from '../review-findings.ts';
import type { ParsedFindingsFile, ValidatedSemanticWalk } from '../review-findings.ts';
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

/**
 * Round store (CMP-001): rounds are classified by status. A round carrying
 * status 'open' is the only mutable round; every other round — including
 * legacy rounds written before the open-to-closed contract that lack a status
 * field — is treated as closed and never modified (FR-004, AC-007).
 */
function isOpenRound(round: unknown): boolean {
  return Boolean(
    round &&
      typeof round === 'object' &&
      (round as Record<string, unknown>).status === 'open'
  );
}

function latestOpenRoundIndex(rounds: unknown[]): number {
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    if (isOpenRound(rounds[i])) return i;
  }
  return -1;
}

/**
 * Deterministic summary of the blocking mechanical findings, used as the
 * round rationale when the reviewer supplies none (DEC-004 fallback).
 */
function mechanicalRationale(blocking: Finding[]): string {
  const items = blocking.map((f) => f.finding).join('; ');
  return `${blocking.length} blocking mechanical finding(s): ${items}`;
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

  // Findings input gate (CMP-002, DEC-005): pre-flight argv validation that
  // runs ahead of the gate check and ahead of every file mutation. Every
  // violation exits before any write so the artifact and review file stay
  // untouched.
  const note = typeof args.note === 'string' ? String(args.note).trim() : '';
  const findingsFile =
    typeof args.findings === 'string' ? String(args.findings).trim() : '';
  const hasReviewerInput = Boolean(note || findingsFile);

  if (note && findingsFile) {
    writeJson(
      {
        workflow,
        step: 'review',
        state: 'blocked',
        instructions: 'Use either --note or --findings, not both.',
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
          change_root: changeRoot,
        },
        errors: [
          makeError('USAGE', { message: 'Use either --note or --findings, not both.' }),
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  if (hasReviewerInput && !args.accept && !args.reject) {
    writeJson(
      {
        workflow,
        step: 'review',
        state: 'blocked',
        instructions: '--note and --findings require a verdict flag (--accept or --reject).',
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
          change_root: changeRoot,
        },
        errors: [
          makeError('USAGE', {
            message: '--note and --findings require a verdict flag (--accept or --reject).',
          }),
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  if (findingsFile && !fs.existsSync(findingsFile)) {
    // The --findings value resolves relative to the process working
    // directory, matching --record-answers behavior (assumption 5).
    writeJson(
      {
        workflow,
        step: 'review',
        state: 'blocked',
        instructions: `--findings file not found: ${findingsFile}`,
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
          change_root: changeRoot,
        },
        errors: [
          makeError('USAGE', { message: `--findings file not found: ${findingsFile}` }),
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  // Findings-file shape validation and target resolution (CMP-003, DEC-005):
  // pre-flight, before the gate result is acted on and before any write. A
  // shape violation refuses the invocation naming the offending entry
  // (AC-012); unknown id-shaped targets only warn while the round is still
  // recorded (AC-013, DEC-001).
  let parsedFindings: ParsedFindingsFile | null = null;
  const targetWarnings: WarningItem[] = [];

  if (findingsFile) {
    try {
      parsedFindings = parseFindingsFile(findingsFile);
    } catch (err: unknown) {
      if (err instanceof FindingsFileError) {
        writeJson(
          {
            workflow,
            step: 'review',
            state: 'blocked',
            instructions: err.message,
            data: {
              target: targetLabel,
              target_artifact: stage.artifact,
              change_root: changeRoot,
            },
            errors: [makeError(err.code, { message: err.message })],
            warnings: [],
          },
          EXIT.usage
        );
        return;
      }
      throw err;
    }

    targetWarnings.push(
      ...resolveFindingTargets(parsedFindings.findings, collectKnownIds(changeRoot))
    );
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

    // Input gate, mechanical-dependent rule (AC-008, AC-009): a rejection
    // with zero mechanical blocking findings requires reviewer input, because
    // the rationale would otherwise be invisible to the CLI. With blocking
    // findings the rejection proceeds without reviewer input. This check runs
    // after mechanical validation but before any write (DEC-005).
    if (args.reject && !hasReviewerInput && blocking.length === 0) {
      writeJson(
        {
          workflow,
          step: 'review',
          state: 'blocked',
          instructions:
            '--reject requires --note or --findings when mechanical checks pass (no blocking findings).',
          data: {
            target: targetLabel,
            target_artifact: trackedStage.artifact,
            artifact: artifactPath,
            change_root: changeRoot,
            blocking_count: blocking.length,
          },
          errors: [
            makeError('USAGE', {
              message:
                '--reject requires --note or --findings when mechanical checks pass (no blocking findings).',
            }),
          ],
          warnings: [],
        },
        EXIT.usage
      );
      return;
    }

    // Semantic walk validation (CMP-004, DEC-003, DEC-005): pre-flight,
    // before any write. Required and all-pass when accepting with passing
    // mechanical checks (FR-011, AC-017); validated for completeness and
    // recorded when supplied with passing mechanicals (FR-010); ignored and
    // not recorded when mechanical blocking findings exist (FR-009, AC-018).
    const semanticRequired = Boolean(args.accept) && blocking.length === 0;
    let semanticWalk: ValidatedSemanticWalk | null = null;

    if (blocking.length === 0 && (parsedFindings?.semantic || semanticRequired)) {
      try {
        semanticWalk = validateSemanticWalk(
          parsedFindings?.semantic ?? null,
          stageChecks,
          semanticRequired
        );
      } catch (err: unknown) {
        if (err instanceof FindingsFileError) {
          writeJson(
            {
              workflow,
              step: 'review',
              state: 'blocked',
              instructions: err.message,
              data: {
                target: targetLabel,
                target_artifact: trackedStage.artifact,
                artifact: artifactPath,
                change_root: changeRoot,
                blocking_count: blocking.length,
              },
              errors: [makeError(err.code, { message: err.message })],
              warnings: [],
            },
            EXIT.usage
          );
          return;
        }
        throw err;
      }
    }

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
            .join('\n')}\n\nAcceptance requires the complete semantic walk: run --accept with --findings supplying one {check_id, status, evidence} item per check above, all status 'pass'. Rejection requires --note or --findings.`
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

    const roundsArr = reviewDoc.rounds as Record<string, unknown>[];
    const isVerdict = Boolean(args.accept || args.reject);
    let recordedRound: number | null = null;

    if (shouldRecord) {
      const mechanicalBlock = {
        valid: blocking.length === 0,
        blocking_count: blocking.length,
        findings,
      };
      const roundWarnings = [
        ...blocking.filter((f) => f.severity !== 'blocking'),
        // Unknown id-shaped finding targets warn while the round is still
        // recorded (AC-013, DEC-001).
        ...targetWarnings,
      ];
      const openIdx = latestOpenRoundIndex(roundsArr);
      const roundBase = (roundNumber: number) => ({
        round: roundNumber,
        reviewed_at: nowIso(),
        artifact_version: metadata.version || null,
        ...(trackedStage.statusField === 'implementation_status'
          ? {
              implementation_status: metadata.implementation_status || null,
            }
          : {}),
      });

      if (!isVerdict) {
        // Bare invocation (FR-001, FR-002): open a round, or refresh the
        // existing open round in place keeping the same round number. Round
        // numbers increment only when a round is appended, never on refresh.
        const roundNumber =
          openIdx >= 0
            ? Number(roundsArr[openIdx].round)
            : roundsArr.length + 1;
        const openRound = {
          ...roundBase(roundNumber),
          decision: 'review',
          status: 'open',
          can_accept: canAccept,
          mechanical: mechanicalBlock,
          warnings: roundWarnings,
        };
        if (openIdx >= 0) roundsArr[openIdx] = openRound;
        else roundsArr.push(openRound);
        recordedRound = roundNumber;
      } else {
        // Verdict (FR-003): complete the latest open round in place, or
        // append a complete closed round when no open round exists. The
        // rationale follows DEC-004 precedence: the --note text when
        // supplied; otherwise the mechanical-findings summary when blocking
        // findings exist; otherwise omitted.
        const rationale =
          note || (blocking.length > 0 ? mechanicalRationale(blocking) : null);
        const roundNumber =
          openIdx >= 0
            ? Number(roundsArr[openIdx].round)
            : roundsArr.length + 1;
        const closedRound = {
          ...roundBase(roundNumber),
          decision,
          status: 'closed',
          can_accept: canAccept,
          mechanical: mechanicalBlock,
          // Semantic block recorded only when supplied, valid, and mechanical
          // checks passed (DM-001, FR-009, AC-018).
          ...(semanticWalk ? { semantic: { results: semanticWalk.results } } : {}),
          // Reviewer findings without severity: blocking by definition on a
          // rejected round, advisory on an accepted one (FR-008, AC-014,
          // AC-015).
          ...(parsedFindings && parsedFindings.findings.length > 0
            ? { findings: parsedFindings.findings }
            : {}),
          // DEC-004 precedence: --note text, else the mechanical-findings
          // summary when blocking findings exist, else omitted — applied
          // uniformly on the accepted, rejected, and accept_blocked paths.
          ...(rationale ? { rationale } : {}),
          warnings: roundWarnings,
        };
        if (openIdx >= 0) roundsArr[openIdx] = closedRound;
        else roundsArr.push(closedRound);
        recordedRound = roundNumber;
      }

      reviewDoc.metadata = {
        ...(reviewDoc.metadata as Record<string, unknown>),
        artifact: trackedStage.artifact,
        target: trackedStage.id,
        latest_round: recordedRound,
        latest_decision: decision,
        updated: today(),
      };

      writeYamlAtomic(reviewPath, reviewDoc);
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
        warnings: [
          ...blocking
            .filter((f) => f.severity !== 'blocking')
            .map((f) => ({ code: 'VALIDATION_WARNING', message: f.finding })),
          // Unknown id-shaped finding targets ride the envelope warnings
          // array while the round is still recorded (AC-013, DEC-001).
          ...targetWarnings,
        ],
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
