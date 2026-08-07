import path from 'node:path';
import type { WarningItem } from '../lib/types.ts';
import { parseArgs, writeJson, EXIT } from '../lib/cli.ts';
import { writeYamlAtomic } from '../lib/yaml-io.ts';
import {
  safeReadYaml,
  makeCtx,
} from '../lib/context.ts';
import {
  resolveRootOrError,
  ResolveRootError,
} from '../lib/resolve-root.ts';
import { today, nowIso } from '../lib/ids.ts';
import {
  loadReviewTargets,
  loadSemanticChecks,
} from '../lib/policy-loader.ts';
import { validateArtifactSchema } from '../lib/schema.ts';
import { checkCrossFileReferences } from '../lib/validators.ts';
import { makeError } from '../lib/error-catalog.ts';

const FALLBACK_TARGETS = {
  requirements: {
    artifact: 'requirements.yaml',
    review_file: 'requirements-review.yaml',
    status_field: 'status',
  },
  design: {
    artifact: 'design.yaml',
    review_file: 'design-review.yaml',
    status_field: 'status',
  },
  plan: {
    artifact: 'plan.yaml',
    review_file: 'plan-review.yaml',
    status_field: 'status',
  },
  implementation: {
    artifact: 'plan.yaml',
    review_file: 'implementation-review.yaml',
    status_field: 'implementation_status',
  },
};

function getTargets(cwd: string): Record<string, unknown> {
  try {
    const config = loadReviewTargets(cwd) as Record<string, unknown> | null;
    if (config && typeof config.targets === 'object') {
      return config.targets as Record<string, unknown>;
    }
  } catch {
    // Use fallback targets if policy loading fails.
  }
  return FALLBACK_TARGETS;
}

function normalizeTarget(value: string | null | undefined, targets: Record<string, unknown>) {
  if (!value) return null;
  const target = String(value).replace(/\.yaml$/, '');
  return targets[target] ? target : null;
}

function usage(code = EXIT.usage, message: string | null = null, targets: Record<string, unknown> = FALLBACK_TARGETS) {
  writeJson(
    {
      workflow: 'review',
      step: 'help',
      state: code === EXIT.ok ? 'ok' : 'blocked',
      instructions:
        'Usage: sdlc review --target <requirements|design|plan|implementation> --dir <change-dir> [--accept|--reject] [--dry-run]',
      data: {
        known_targets: Object.keys(targets),
      },
      errors:
        code === EXIT.ok
          ? []
          : [makeError('USAGE', {
              message:
                message ||
                'review requires --target <requirements|design|plan|implementation> and --dir <change-dir>',
            })],
      warnings: [],
    },
    code
  );
}

export function runReview(argv: string[]) {
  const args = parseArgs(argv);
  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
  const targets = getTargets(cwd);

  if (args.help) {
    usage(EXIT.ok, null, targets);
    return;
  }

  const target = normalizeTarget(args.target as string | null | undefined, targets);
  if (!target) {
    usage(EXIT.usage, null, targets);
    return;
  }

  const cfg = targets[target] as { artifact: string; review_file: string; status_field: string; };
  const dryRun = Boolean(args['dry-run']);
  const shouldRecord = !dryRun;

  const base: Record<string, unknown> = {
    workflow: 'review',
    step: 'review',
    data: {
      target,
      target_artifact: cfg.artifact,
    },
  };

  if (!args.dir) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions: 'Provide --dir <change-dir>.',
        data: {
          target,
          target_artifact: cfg.artifact,
        },
        errors: [makeError('MISSING_CHANGE_DIR')],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  let changeRoot;
  try {
    changeRoot = resolveRootOrError(String(args.dir), { cwd });
  } catch (err: unknown) {
    if (err instanceof ResolveRootError) {
      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions: err.message,
          data: {
            target,
            target_artifact: cfg.artifact,
            candidates: err.candidates || [],
          },
          errors: [
            makeError(
              err.candidates && err.candidates.length > 0 ? 'AMBIGUOUS_CHANGE_DIR' : 'CHANGE_DIR_NOT_FOUND',
              { message: err.message, candidates: err.candidates || [] }
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
        ...base,
        state: 'blocked',
        instructions: 'Use either --accept or --reject, not both.',
        data: {
          target,
          target_artifact: cfg.artifact,
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
    const artifactPath = path.join(changeRoot, cfg.artifact);
    const artifact = safeReadYaml(artifactPath) as Record<string, unknown> | null;

    if (!artifact) {
      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions: `No ${cfg.artifact} found in ${changeRoot}. Run the relevant stage first.`,
          data: {
            target,
            target_artifact: cfg.artifact,
            artifact: artifactPath,
            change_root: changeRoot,
          },
          errors: [makeError('ARTIFACT_NOT_FOUND', { message: `No ${cfg.artifact} found in ${changeRoot}.` })],
          warnings: [],
        },
        EXIT.actionFailed
      );
      return;
    }

    const warnings: WarningItem[] = [];
    const ctx = makeCtx(cwd, changeRoot);

    const schemaFindings = validateArtifactSchema(target, artifact, cwd);
    const refFindings = checkCrossFileReferences(target, artifact, changeRoot);
    
    const findings = [...schemaFindings, ...refFindings];
    const blocking = findings.map(f => ({
      check: 'validation',
      severity: 'blocking',
      category: 'structural',
      target: 'doc',
      finding: f.finding || (f as any).message,
      fix: 'Fix the error'
    }));

    const currentStatus = ((artifact as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined)?.[cfg.status_field] as string | undefined;
    const readyForReview = currentStatus === 'ready-for-review' || currentStatus === 'accepted';

    // Semantic checks are now purely advisory text for the LLM to read before accepting
    const allSemanticChecks = loadSemanticChecks(cwd);
    const stageChecks = (allSemanticChecks[target] || []) as string[];

    let canAccept = readyForReview && blocking.length === 0;

    let decision = 'review';
    let state = canAccept ? 'ok' : 'blocked';
    let instructions = '';
    const errors: { code: string; message: string }[] = [];

    if (args.accept) {
      decision = canAccept ? 'accepted' : 'accept_blocked';

      if (canAccept) {
        if (!dryRun) {
          const meta = artifact.metadata as Record<string, unknown> || {};
          artifact.metadata = meta;
          meta[cfg.status_field] = 'accepted';
          meta.updated = today();
          writeYamlAtomic(artifactPath, artifact);
        }

        state = 'complete';
        instructions = `The ${target} review was accepted. The artifact status is now 'accepted'.`;
        if (dryRun) instructions += ' Dry run: no changes were written.';
      } else {
        state = 'blocked';
        instructions = `The ${target} artifact cannot be accepted yet. It must be ready-for-review and have no blocking structural/reference findings.`;
        errors.push(makeError('CANNOT_ACCEPT', { message: `ready_for_review=${readyForReview}, blocking=${blocking.length}` }));
      }
    } else if (args.reject) {
      decision = 'rejected';

      if (!dryRun) {
        const meta = artifact.metadata as Record<string, unknown> || {};
        artifact.metadata = meta;
        meta[cfg.status_field] = 'rejected';
        meta.updated = today();
        writeYamlAtomic(artifactPath, artifact);
      }

      state = 'blocked';
      instructions = `The ${target} review was rejected. Run the corresponding authoring or implementation workflow to fix the findings, then review again.`;
      if (dryRun) instructions += ' Dry run: no changes were written.';
    } else {
      instructions = canAccept
        ? `The ${target} artifact passed structural validation. Please review the following semantic checks:\n\n${stageChecks.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nIf all pass, accept with --accept.`
        : `The ${target} artifact cannot be accepted yet. Fix the blocking findings and review again.`;

      if (dryRun) instructions += ' Dry run: no changes were written.';

      if (!canAccept) {
        errors.push(makeError('REVIEW_NOT_PASSING', { message: `ready_for_review=${readyForReview}, blocking=${blocking.length}` }));
      }
    }

    const reviewPath = path.join(changeRoot, cfg.review_file);
    const reviewDoc: Record<string, unknown> = (safeReadYaml(reviewPath) as Record<string, unknown> | null) || {
      metadata: {
        artifact: cfg.artifact,
        target,
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
    const recordRound = shouldRecord && !(args.reject && errors.some((e) => e.code === 'ILLEGAL_STATUS_TRANSITION'));

    if (recordRound) {
      const round = {
        round: roundNumber,
        reviewed_at: nowIso(),
        artifact_version: (artifact.metadata as Record<string, unknown>)?.version || null,
        ...(target === 'implementation'
          ? {
              implementation_status:
                (artifact.metadata as Record<string, unknown>)?.implementation_status || null,
            }
          : {}),
        decision,
        can_accept: canAccept,
        mechanical: {
          valid: blocking.length === 0,
          blocking_count: blocking.length,
          findings,
        },
        warnings: blocking.filter(f => f.severity !== 'blocking'),
      };

      (reviewDoc.rounds as unknown[]).push(round);
      reviewDoc.metadata = {
        ...(reviewDoc.metadata as Record<string, unknown>),
        artifact: cfg.artifact,
        target,
        latest_round: roundNumber,
        latest_decision: decision,
        updated: today(),
      };

      writeYamlAtomic(reviewPath, reviewDoc);
      recordedRound = roundNumber;
    }

    writeJson(
      {
        ...base,
        state,
        instructions,
        data: {
          target,
          target_artifact: cfg.artifact,
          artifact: artifactPath,
          change_root: changeRoot,
          review_file: reviewPath,
          decision,
          can_accept: canAccept,
          dry_run: dryRun,
          artifact_status: (artifact.metadata as Record<string, unknown>)?.[cfg.status_field] as string | null || null,
          blocking_count: blocking.length,
          blocking_findings: blocking,
          round: recordedRound,
        },
        errors,
        warnings: blocking.filter(f => f.severity !== 'blocking').map(f => ({ code: 'VALIDATION_WARNING', message: f.finding })) as WarningItem[],
      },
      EXIT.ok
    );
  } catch (err: unknown) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions: err instanceof Error ? err.message : String(err),
        data: {
          target,
          target_artifact: cfg.artifact,
          change_root: changeRoot,
        },
        errors: [makeError('INTERNAL_ERROR', { message: err instanceof Error ? err.message : String(err) })],
        warnings: [],
      },
      EXIT.internal
    );
  }
}