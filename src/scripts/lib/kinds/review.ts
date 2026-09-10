import path from 'node:path';
import fs from 'node:fs';

import type { StageRecord } from '../stage-registry.ts';
import { getStageById } from '../stage-registry.ts';
import { parseArgs, writeJson, EXIT, CWD_FLAG_DOC } from '../cli.ts';
import { writeYamlAtomic, readYaml } from '../yaml-io.ts';
import { safeReadYaml } from '../context.ts';
import { resolveRootOrError, ResolveRootError } from '../resolve-root.ts';
import { today, nowIso } from '../ids.ts';
import { loadStepDefinitions } from '../steps-loader.ts';
import { buildStepVars, renderStepHelp, renderTemplate } from '../step-render.ts';
import { validateArtifact } from '../validate.ts';
import { evaluateGate } from '../requires-graph.ts';
import { makeError } from '../error-catalog.ts';
import { helpEnvelope, rejectUnknownFlags, REVIEW_FLAGS } from '../help.ts';
import {
  FailureFileError,
  parseFailuresFile,
  parseFailuresStdin,
  validateSemanticFailures,
} from '../review-findings.ts';
import type { Failure } from '../review-findings.ts';
import type { WarningItem, Finding } from '../types.ts';

function semanticChecksFor(stage: StageRecord): string[] {
  if (!stage.files.semanticChecks) return [];
  const doc = readYaml(stage.files.semanticChecks) as { checks?: unknown } | null;
  return Array.isArray(doc?.checks)
    ? (doc.checks as unknown[]).filter((c) => typeof c === 'string') as string[]
    : [];
}

/**
 * Maps a CLI-computed mechanical finding to the uniform {check, evidence}
 * failure shape: the fix hint is folded into the evidence (which already
 * names its target). Every finding is a failure — a finding blocks by
 * definition. Mechanical failures are always
 * CLI-computed — never reviewer-supplied.
 */
function toFailure(finding: Finding): Failure {
  const parts = [finding.finding.trim()];
  if (finding.fix && finding.fix.trim()) parts.push(`Fix: ${finding.fix.trim()}`);
  return { check: finding.check, evidence: parts.join(' ') };
}

/**
 * Round store (CMP-001): rounds are classified by their merged status —
 * 'open' is the only mutable round; every other round ('accepted',
 * 'rejected', and legacy rounds written before the merged-status contract
 * that lack a status field) is treated as closed and never modified.
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

function failureLines(failures: Failure[]): string {
  return failures.map((f) => ` - ${f.check}: ${f.evidence}`).join('\n');
}

export async function runReviewStage(
  stage: StageRecord,
  argv: string[],
  cwd: string
): Promise<void> {
  const args = parseArgs(argv);
  rejectUnknownFlags(stage.id, args, REVIEW_FLAGS);
  const command = stage.id;
  const targetStage = stage.reviews ? getStageById(cwd, stage.reviews) : null;
  const targetLabel = stage.reviews || stage.id;

  // Step-data-driven surface (DM-003): the envelope step id, the instruction
  // base markdown, and the opt-in step_help payload all come from the stage's
  // steps.yaml. Failure paths keep computed instructions — runtime state, not
  // definitions.
  const stepDefinitions = loadStepDefinitions(stage);
  const stepVars = (changeRoot: string | null) =>
    buildStepVars(stage.id, changeRoot, cwd, { target: targetLabel });
  const markdownFor = (stepId: string, changeRoot: string | null) => {
    const step = stepDefinitions[stepId];
    return step ? renderTemplate(step.markdown || '', stepVars(changeRoot)).trim() : '';
  };
  const helpFor = (stepId: string, changeRoot: string | null) =>
    renderStepHelp(stepId, stepDefinitions[stepId], stepVars(changeRoot));
  const compose = (markdown: string, annex: string) =>
    [markdown, annex.trim()].filter(Boolean).join('\n\n');
  const helpStep = Boolean(args['help-step']);
  let stepId = 'review';

  const usage = (code: number, message: string | null = null) => {
    if (code === EXIT.ok) {
      writeJson(
        helpEnvelope({
          command: stage.id,
          purpose: `Review gate for ${targetLabel}: run the mechanical + semantic checks and record the verdict.`,
          usage: [
            `sdlc ${stage.id} --change <change-name>`,
            `sdlc ${stage.id} --change <change-name> --list-semantic-checks`,
            `sdlc ${stage.id} --change <change-name> --dry-run`,
            `sdlc ${stage.id} --change <change-name> --accept`,
            `sdlc ${stage.id} --change <change-name> --reject --failures <file|->`,
          ],
          flags: REVIEW_FLAGS,
          extraData: targetStage ? { reviews: targetStage.id } : {},
        }),
        code
      );
      return;
    }

    writeJson(
      {
        command,
        step: 'help',
        state: 'blocked',
        instructions:
          `Usage: sdlc ${stage.id} --change <change-name> [--accept|--reject] [--failures <file|->] [--list-semantic-checks] [--dry-run] ` +
          CWD_FLAG_DOC,
        data: {
          ...(targetStage ? { reviews: targetStage.id } : {}),
        },
        errors: [
          makeError('USAGE', {
            message: message || `review requires --change <change-name>`,
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

  if (!args.change) {
    writeJson(
      {
        command,
        step: 'blocked',
        state: 'blocked',
        instructions: compose(
          "A stage invocation must be engaged with a change: provide --change <change-name> (one of data.available_changes). Change identification is the skill's job, never a stage step.",
          'Provide --change <change-name>.'
        ),
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
          available_changes: [],
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
          command,
          step: 'blocked',
          state: 'blocked',
          instructions: compose('', err.message),
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

  // Declared-checks listing (informational): prints the target stage's
  // declared semantic checks and exits without opening, refreshing, or
  // writing any round — a pure read over the stage's semantic-checks.yaml.
  if (args['list-semantic-checks']) {
    const listStage = targetStage || stage;
    const checks = semanticChecksFor(listStage);
    writeJson(
      {
        command,
        step: 'list_checks',
        state: 'ok',
        instructions:
          `The ${listStage.id} stage declares ${checks.length} semantic checks. ` +
          `A check's name is its full question text, copied verbatim — checklist numbers are list positions, not names; ` +
          `record at most one entry per failed check, merging all of that check's findings into the single entry's evidence.`,
        data: {
          target: targetLabel,
          semantic_checks: checks,
        },
        errors: [],
        warnings: [],
      },
      EXIT.ok
    );
    return;
  }

  // Detected step (DM-003): the verdict flags select the accept/reject steps;
  // everything else is the review step.
  stepId = args.accept ? 'accept' : args.reject ? 'reject' : 'review';

  if (args.accept && args.reject) {
    writeJson(
      {
        command,
        step: stepId,
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

  // Pre-flight argv validation: every violation exits before any file
  // mutation so the artifact and review file stay untouched.
  const failuresFile =
    typeof args.failures === 'string' ? String(args.failures).trim() : '';

  if (failuresFile && args.accept) {
    writeJson(
      {
        command,
        step: stepId,
        state: 'blocked',
        instructions:
          '--failures is not valid with --accept: mechanical failures are CLI-computed and an accepted round records failures [].',
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
          change_root: changeRoot,
        },
        errors: [
          makeError('USAGE', {
            message: '--failures is not valid with --accept.',
          }),
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  if (failuresFile && !args.reject) {
    writeJson(
      {
        command,
        step: stepId,
        state: 'blocked',
        instructions: '--failures requires --reject.',
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
          change_root: changeRoot,
        },
        errors: [
          makeError('USAGE', { message: '--failures requires --reject.' }),
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  if (failuresFile && failuresFile !== '-' && !fs.existsSync(failuresFile)) {
    // The --failures value resolves relative to the process working
    // directory, matching --record-answers behavior (assumption 5); the
    // special value '-' reads the failures YAML from stdin instead of a file.
    writeJson(
      {
        command,
        step: stepId,
        state: 'blocked',
        instructions: `--failures file not found: ${failuresFile}`,
        data: {
          target: targetLabel,
          target_artifact: stage.artifact,
          change_root: changeRoot,
        },
        errors: [
          makeError('USAGE', { message: `--failures file not found: ${failuresFile}` }),
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  // Failures-file shape validation: pre-flight, before the gate result is
  // acted on and before any write. A shape violation refuses the invocation
  // naming the offending entry and nothing is written.
  let semanticFailures: Failure[] | null = null;

  if (failuresFile) {
    try {
      semanticFailures = failuresFile === '-' ? parseFailuresStdin() : parseFailuresFile(failuresFile);
    } catch (err: unknown) {
      if (err instanceof FailureFileError) {
        writeJson(
          {
            command,
            step: stepId,
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
  }

  try {
    // Review gate (DEC-008): the tracked artifact must be ready-for-review.
    // An accepted artifact is already through the gate — re-review requires
    // the author to update and re-finalize; a rejected one is gate-blocked.
    const gate = evaluateGate(stage, changeRoot, cwd);
    if (!gate.satisfied) {
      const alreadyAccepted = gate.unsatisfied.some((u) => u.status === 'accepted');
      writeJson(
        {
          command,
          step: stepId,
          state: 'blocked',
          instructions: alreadyAccepted
            ? `The ${targetLabel} artifact is already accepted; re-review requires the author to update and re-finalize.`
            : 'The review gate is not satisfied:\n - ' +
              gate.unsatisfied
                .map((u) => `${u.stage} (${u.artifact} status '${u.status}', required ${u.required})`)
                .join('\n - '),
          data: {
            target: targetLabel,
            target_artifact: stage.artifact,
            change_root: changeRoot,
            unsatisfied_requirements: gate.unsatisfied,
          },
          errors: [
            makeError('STAGE_GATE_BLOCKED', {
              message: alreadyAccepted
                ? `The ${targetLabel} artifact is already accepted; re-review requires the author to update and re-finalize.`
                : 'Tracked artifact is not ready for review.',
            }),
          ],
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
          command,
          step: stepId,
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

    // Unified validation path: identical findings to internal finalize (FR-006).
    // Every finding is a failure — a finding blocks by definition
    // (failure-only contract).
    const findings = validateArtifact(trackedStage.id, artifact, cwd, changeRoot);
    const mechanicalFailures = findings.map(toFailure);
    const mechanicalValid = findings.length === 0;

    // Mechanical-dependent refusals (failure-only contract): a rejection with
    // passing mechanical checks requires the failed semantic checks as
    // evidence, and a --failures file is refused when mechanical failures
    // exist because mechanical failures are CLI-computed, never
    // reviewer-supplied. Both run after mechanical validation but before any
    // write.
    if (args.reject && mechanicalValid && !semanticFailures) {
      const message =
        '--reject requires --failures <file> when mechanical checks pass: supply the failed semantic checks as a top-level YAML list of {check, evidence}.';
      writeJson(
        {
          command,
          step: stepId,
          state: 'blocked',
          instructions: message,
          data: {
            target: targetLabel,
            target_artifact: trackedStage.artifact,
            artifact: artifactPath,
            change_root: changeRoot,
            failures: [],
          },
          errors: [makeError('USAGE', { message })],
          warnings: [],
        },
        EXIT.usage
      );
      return;
    }

    if (semanticFailures && !mechanicalValid) {
      const message =
        '--failures is not valid while mechanical checks fail: mechanical failures are CLI-computed and recorded automatically. Drop --failures or fix the mechanical failures first.';
      writeJson(
        {
          command,
          step: stepId,
          state: 'blocked',
          instructions: compose(message, `Mechanical failures:\n${failureLines(mechanicalFailures)}`),
          data: {
            target: targetLabel,
            target_artifact: trackedStage.artifact,
            artifact: artifactPath,
            change_root: changeRoot,
            failures: mechanicalFailures,
          },
          errors: [makeError('USAGE', { message })],
          warnings: [],
        },
        EXIT.usage
      );
      return;
    }

    // Semantic failures validation against the target stage's declared checks
    // (CMP-003): pre-flight, before any write. Only the reject-with-failures
    // path dispositioned the semantic checklist.
    if (semanticFailures) {
      try {
        const stageChecks = semanticChecksFor(trackedStage);
        validateSemanticFailures(semanticFailures, stageChecks);
      } catch (err: unknown) {
        if (err instanceof FailureFileError) {
          writeJson(
            {
              command,
              step: stepId,
              state: 'blocked',
              instructions: err.message,
              data: {
                target: targetLabel,
                target_artifact: trackedStage.artifact,
                artifact: artifactPath,
                change_root: changeRoot,
                failures: [],
                // The declared checks ride the refusal so the retry needs no
                // extra listing call.
                semantic_checks: semanticChecksFor(trackedStage),
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

    const metadata = (artifact.metadata as Record<string, unknown>) || {};
    const dryRun = Boolean(args['dry-run']);
    const shouldRecord = !dryRun;

    // Round status vocabulary (merged field): open | accepted | rejected.
    let roundStatus: 'open' | 'accepted' | 'rejected';
    let state: string;
    let instructions = '';
    const errors: { code: string; message: string }[] = [];
    // The semantic checklist is dispositioned only on the accepted path and
    // the reject-with-semantic-failures path.
    let semanticValid: boolean | null = null;
    let roundFailures: Failure[];

    if (args.accept) {
      if (mechanicalValid) {
        // Accepted: failures [] and both valid flags true.
        roundStatus = 'accepted';
        semanticValid = true;
        state = 'complete';
        roundFailures = [];

        if (!dryRun) {
          metadata[trackedStage.statusField] = 'accepted';
          metadata.updated = today();
          writeYamlAtomic(artifactPath, artifact);
        }

        instructions = compose(
          markdownFor('accept', changeRoot),
          `The ${trackedStage.id} review was accepted. The artifact status is now 'accepted'.` +
            (dryRun ? ' Dry run: no changes were written.' : '')
        );
      } else {
        // FORCED REJECTED: acceptance is impossible while mechanical checks
        // fail. The round is recorded rejected and the artifact is flipped to
        // rejected so the author fixes the recorded failures first.
        roundStatus = 'rejected';
        semanticValid = null;
        state = 'blocked';
        roundFailures = mechanicalFailures;

        if (!dryRun) {
          metadata[trackedStage.statusField] = 'rejected';
          metadata.updated = today();
          writeYamlAtomic(artifactPath, artifact);
        }

        instructions = compose(
          markdownFor('accept', changeRoot),
          `Acceptance is impossible while mechanical checks fail: the round was recorded as rejected and the artifact status was flipped to rejected. Fix the recorded failures, re-finalize the artifact, then run the review again.\n\nMechanical failures:\n${failureLines(mechanicalFailures)}` +
            (dryRun ? '\n\nDry run: no changes were written.' : '')
        );
        errors.push(
          makeError('REVIEW_NOT_PASSING', {
            message: `Acceptance is impossible while mechanical checks fail (${mechanicalFailures.length} mechanical finding(s)).`,
          })
        );
      }
    } else if (args.reject) {
      roundStatus = 'rejected';
      state = 'blocked';

      if (!dryRun) {
        metadata[trackedStage.statusField] = 'rejected';
        metadata.updated = today();
        writeYamlAtomic(artifactPath, artifact);
      }

      if (!mechanicalValid) {
        // Rejection with mechanical failures: CLI-computed evidence, no input
        // needed; the semantic checklist was not dispositioned.
        roundFailures = mechanicalFailures;
        instructions = compose(
          markdownFor('reject', changeRoot),
          `The ${trackedStage.id} review was rejected. Mechanical checks failed:\n${failureLines(mechanicalFailures)}\n\nFix the recorded failures, re-finalize the artifact, then run the review again.` +
            (dryRun ? '\n\nDry run: no changes were written.' : '')
        );
      } else {
        // Rejection with failed semantic checks supplied via --failures: the
        // semantic checklist was dispositioned and did not pass.
        semanticValid = false;
        roundFailures = semanticFailures as Failure[];
        instructions = compose(
          markdownFor('reject', changeRoot),
          `The ${trackedStage.id} review was rejected. Failed semantic checks recorded from --failures:\n${failureLines(semanticFailures || [])}\n\nFix the recorded failures, re-finalize the artifact, then run the review again.` +
            (dryRun ? '\n\nDry run: no changes were written.' : '')
        );
      }
    } else {
      // Bare invocation: open or refresh the round; mechanical failures are
      // listed when present.
      roundStatus = 'open';
      roundFailures = mechanicalFailures;

      if (mechanicalValid) {
        state = 'ok';
        const stageChecks = semanticChecksFor(trackedStage);
        instructions = compose(
          markdownFor('review', changeRoot),
          `The ${trackedStage.id} artifact passed mechanical validation. Review the semantic checklist:\n\n${stageChecks
            .map((c, i) => `${i + 1}. ${c}`)
            .join('\n')}\n\nThe numbers above are list positions, not names: a semantic check's name is its full question text, copied verbatim; record at most one entry per failed check, merging all of that check's findings into the single entry's evidence.\n\nVerdict guidance: --accept accepts the artifact (failures recorded as []); --reject --failures <file> records the failed semantic checks as a top-level YAML list of {check, evidence}. Complete the verdict in this session — a review without a recorded verdict is an incomplete review, and a bare re-invocation only refreshes the open round.`
        );
      } else {
        state = 'blocked';
        instructions = compose(
          markdownFor('review', changeRoot),
          `Mechanical checks failed:\n${failureLines(mechanicalFailures)}\n\nFix the recorded failures in the artifact, re-finalize, and run the review again.`
        );
        errors.push(
          makeError('REVIEW_NOT_PASSING', {
            message: `Mechanical checks failed (${mechanicalFailures.length} mechanical finding(s)).`,
          })
        );
      }

      if (dryRun) instructions += ' Dry run: no changes were written.';
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
    let recordedRound: number | null = null;

    if (shouldRecord) {
      const openIdx = latestOpenRoundIndex(roundsArr);
      const roundNumber =
        openIdx >= 0 ? Number(roundsArr[openIdx].round) : roundsArr.length + 1;
      const round: Record<string, unknown> = {
        round: roundNumber,
        reviewed_at: nowIso(),
        artifact_version: metadata.version || null,
        ...(trackedStage.statusField === 'implementation_status'
          ? {
              implementation_status: metadata.implementation_status || null,
            }
          : {}),
        status: roundStatus,
        mechanical_checks_passed: mechanicalValid,
        // Semantic flag recorded only when the semantic checklist was
        // dispositioned (accepted, or rejected with failed semantic checks).
        ...(semanticValid !== null ? { semantic_checks_passed: semanticValid } : {}),
        failures: roundFailures,
      };

      // A verdict completes the latest open round in place; a round is
      // appended only when no open round exists (round numbers increment only
      // on append, never on refresh).
      if (openIdx >= 0) roundsArr[openIdx] = round;
      else roundsArr.push(round);
      recordedRound = roundNumber;

      reviewDoc.metadata = {
        ...(reviewDoc.metadata as Record<string, unknown>),
        artifact: trackedStage.artifact,
        target: trackedStage.id,
        latest_round: recordedRound,
        latest_status: roundStatus,
        updated: today(),
      };

      writeYamlAtomic(reviewPath, reviewDoc);
    }

    writeJson(
      {
        command,
        step: stepId,
        state,
        instructions,
        data: {
          target: targetLabel,
          target_artifact: trackedStage.artifact,
          artifact: artifactPath,
          change_root: changeRoot,
          review_file: reviewPath,
          status: roundStatus,
          failures: roundFailures,
          // Structured checklist (bare invocations only): the declared checks
          // ride the review envelope so copying a check name into a --failures
          // entry is mechanical; verdict envelopes stay lean.
          ...(args.accept || args.reject ? {} : { semantic_checks: semanticChecksFor(trackedStage) }),
          dry_run: dryRun,
          artifact_status: metadata[trackedStage.statusField] as string | null || null,
          round: recordedRound,
          // Opt-in step guidance (DEC-003): rendered from the stage's
          // steps.yaml, included only with --help-step.
          ...(helpStep ? { step_help: helpFor(stepId, changeRoot) } : {}),
        },
        errors,
        // Failure-only contract: every finding is a failure recorded in
        // data.failures — no advisory warnings remain.
        warnings: [],
      },
      EXIT.ok
    );
  } catch (err: unknown) {
    writeJson(
      {
        command,
        step: stepId,
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

