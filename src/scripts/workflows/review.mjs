import path from 'node:path';
import { parseArgs, writeJson, EXIT } from '../lib/cli.mjs';
import { writeYamlAtomic } from '../lib/yaml-io.mjs';
import { runChecks } from '../lib/contract-checks.mjs';
import {
  safeReadYaml,
  requireContract,
  makeCtx,
  semanticSummary,
} from '../lib/context.mjs';
import {
  resolveRootOrError,
  ResolveRootError,
} from '../lib/resolve-root.mjs';
import { today, nowIso } from '../lib/ids.mjs';
import {
  loadReviewTargets,
  loadSemanticPolicy,
  loadLifecycle,
} from '../lib/policy-loader.mjs';
import { validateArtifactSchema } from '../lib/schema.mjs';
import { assertTransition } from '../lib/lifecycle.mjs';

const FALLBACK_TARGETS = {
  requirements: {
    artifact: 'requirements.yaml',
    contract: 'requirements-contract.yaml',
    review_file: 'requirements-review.yaml',
    status_field: 'status',
  },
  design: {
    artifact: 'design.yaml',
    contract: 'design-contract.yaml',
    review_file: 'design-review.yaml',
    status_field: 'status',
  },
  plan: {
    artifact: 'plan.yaml',
    contract: 'plan-contract.yaml',
    review_file: 'plan-review.yaml',
    status_field: 'status',
  },
  implementation: {
    artifact: 'plan.yaml',
    contract: 'implementation-contract.yaml',
    review_file: 'implementation-review.yaml',
    status_field: 'implementation_status',
  },
};

function getTargets(cwd) {
  try {
    const config = loadReviewTargets(cwd);
    if (config && typeof config.targets === 'object') {
      return config.targets;
    }
  } catch {
    // Use fallback targets if policy loading fails.
  }
  return FALLBACK_TARGETS;
}

function normalizeTarget(value, targets) {
  if (!value) return null;
  const target = String(value).replace(/\.yaml$/, '');
  return targets[target] ? target : null;
}

function usage(code = EXIT.usage, message = null, targets = FALLBACK_TARGETS) {
  writeJson(
    {
      workflow: 'review',
      step: 'help',
      state: code === EXIT.ok ? 'ok' : 'blocked',
      instructions:
        'Usage: sdlc review --target <requirements|design|plan|implementation> --dir <change-dir> [--accept|--reject] [--dry-run] [--record] [--debug]',
      data: {
        known_targets: Object.keys(targets),
      },
      errors:
        code === EXIT.ok
          ? []
          : [
              {
                code: 'USAGE',
                message:
                  message ||
                  'review requires --target <requirements|design|plan|implementation> and --dir <change-dir>',
              },
            ],
      warnings: [],
    },
    code
  );
}

export function runReview(argv) {
  const args = parseArgs(argv);
  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
  const targets = getTargets(cwd);

  if (args.help) {
    usage(EXIT.ok, null, targets);
    return;
  }

  const target = normalizeTarget(args.target, targets);
  if (!target) {
    usage(EXIT.usage, null, targets);
    return;
  }

  const cfg = targets[target];
  const dryRun = Boolean(args['dry-run']);
  const shouldRecord = !dryRun;

  const base = {
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
        errors: [
          {
            code: 'MISSING_CHANGE_DIR',
            message: 'A change directory is required. Use --dir <change-dir>.',
          },
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  let changeRoot;
  try {
    changeRoot = resolveRootOrError(String(args.dir), { cwd });
  } catch (err) {
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
            {
              code:
                err.candidates && err.candidates.length > 0
                  ? 'AMBIGUOUS_CHANGE_DIR'
                  : 'CHANGE_DIR_NOT_FOUND',
              message: err.message,
              candidates: err.candidates || [],
            },
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
        errors: [
          {
            code: 'CONFLICTING_DECISION',
            message: 'Use either --accept or --reject, not both.',
          },
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  try {
    const artifactPath = path.join(changeRoot, cfg.artifact);
    const artifact = safeReadYaml(artifactPath);

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
          errors: [
            {
              code: 'ARTIFACT_NOT_FOUND',
              message: `No ${cfg.artifact} found in ${changeRoot}.`,
            },
          ],
          warnings: [],
        },
        EXIT.actionFailed
      );
      return;
    }

    const warnings = [];
    let contract;
    try {
      contract = requireContract(cfg.contract, cwd, warnings);
    } catch (err) {
      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions: err.message,
          data: {
            target,
            target_artifact: cfg.artifact,
            artifact: artifactPath,
            change_root: changeRoot,
          },
          errors: [
            {
              code: 'CONTRACT_MISSING',
              message: err.message,
            },
          ],
          warnings,
        },
        EXIT.internal
      );
      return;
    }

    let ctx = makeCtx(cwd, changeRoot);
    if (target === 'implementation') {
      const changed = new Set();
      for (const task of Array.isArray(artifact.tasks) ? artifact.tasks : []) {
        for (const file of task?.files_changed || []) {
          const p = typeof file === 'string' ? file : file?.path;
          if (p) changed.add(p);
        }
      }
      ctx = {
        ...ctx,
        changedFiles() {
          return [...changed];
        },
      };
    }

    const schemaFindings = validateArtifactSchema(target, artifact, cwd);

    let contractFindings = [];
    try {
      contractFindings = runChecks(artifact, contract, ctx, {
        gate: 'review',
      });
    } catch (err) {
      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions: err.message,
          data: {
            target,
            target_artifact: cfg.artifact,
            artifact: artifactPath,
            change_root: changeRoot,
          },
          errors: [
            {
              code: 'CHECK_RUN_FAILED',
              message: err.message,
            },
          ],
          warnings,
        },
        EXIT.internal
      );
      return;
    }

    const findings = [...schemaFindings, ...contractFindings];
    const blocking = findings.filter((f) => f.severity === 'blocking');
    const nonBlocking = findings.filter((f) => f.severity !== 'blocking');

    let semanticOptions = {};
    try {
      const semanticPolicy = loadSemanticPolicy(cwd);
      semanticOptions = {
        minEvidenceChars:
          semanticPolicy?.semantic_validation?.default_min_evidence_chars,
      };
    } catch {
      semanticOptions = {};
    }

    const semantic = semanticSummary(artifact, contract, semanticOptions);
    const currentStatus = artifact?.metadata?.[cfg.status_field];
    const readyForReview =
      currentStatus === 'ready-for-review' || currentStatus === 'accepted';

    let canAccept =
      readyForReview && blocking.length === 0 && semantic.complete;

    let lifecycle = {};
    try {
      lifecycle = loadLifecycle(cwd);
    } catch {
      lifecycle = {};
    }

    const statusKind =
      cfg.status_field === 'implementation_status'
        ? 'implementation_status'
        : 'artifact_status';

    let decision = 'review';
    let state = canAccept ? 'ok' : 'blocked';
    let instructions = '';
    const errors = [];

    if (args.accept) {
      decision = canAccept ? 'accepted' : 'accept_blocked';

      if (canAccept) {
        try {
          assertTransition(lifecycle, statusKind, currentStatus, 'accepted');
        } catch (err) {
          canAccept = false;
          decision = 'accept_blocked';
          errors.push({
            code: err.code || 'ILLEGAL_STATUS_TRANSITION',
            message: err.message,
          });
        }
      }

      if (canAccept) {
        if (!dryRun) {
          if (!artifact.metadata) artifact.metadata = {};
          artifact.metadata[cfg.status_field] = 'accepted';
          artifact.metadata.updated = today();
          writeYamlAtomic(artifactPath, artifact);
        }

        state = 'complete';
        instructions = `The ${target} review was accepted. The artifact status is now '${
          artifact.metadata[cfg.status_field]
        }'.`;

        if (dryRun) {
          instructions += ' Dry run: no changes were written.';
        }
      } else {
        state = 'blocked';
        instructions = `The ${target} artifact cannot be accepted yet. It must be ready-for-review, have no blocking findings, and have complete semantic validation.`;

        errors.push({
          code: 'CANNOT_ACCEPT',
          message: `ready_for_review=${readyForReview}, blocking=${blocking.length}, semantic_complete=${semantic.complete}`,
        });
      }
    } else if (args.reject) {
      decision = 'rejected';

      try {
        assertTransition(lifecycle, statusKind, currentStatus, 'rejected');
      } catch (err) {
        state = 'blocked';
        errors.push({
          code: err.code || 'ILLEGAL_STATUS_TRANSITION',
          message: err.message,
        });
        instructions = `The ${target} artifact could not be rejected because of an illegal lifecycle transition.`;
      }

      if (errors.length === 0) {
        if (!dryRun) {
          if (!artifact.metadata) artifact.metadata = {};
          artifact.metadata[cfg.status_field] = 'rejected';
          artifact.metadata.updated = today();
          writeYamlAtomic(artifactPath, artifact);
        }

        state = 'blocked';
        instructions = `The ${target} review was rejected. Run the corresponding authoring or implementation workflow to fix the findings, then review again.`;

        if (dryRun) {
          instructions += ' Dry run: no changes were written.';
        }
      }
    } else {
      instructions = canAccept
        ? `The ${target} artifact passed review. Accept it with --accept.`
        : `The ${target} artifact cannot be accepted yet. Fix the blocking findings and review again.`;

      if (dryRun) {
        instructions += ' Dry run: no changes were written.';
      }

      if (!canAccept) {
        errors.push({
          code: 'REVIEW_NOT_PASSING',
          message: `ready_for_review=${readyForReview}, blocking=${blocking.length}, semantic_complete=${semantic.complete}`,
        });
      }
    }

    const reviewPath = path.join(changeRoot, cfg.review_file);
    const reviewDoc = safeReadYaml(reviewPath) || {
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

    const roundNumber = reviewDoc.rounds.length + 1;
    let recordedRound = null;
    const recordRound = shouldRecord && !(args.reject && errors.some((e) => e.code === 'ILLEGAL_STATUS_TRANSITION'));

    if (recordRound) {
      const round = {
        round: roundNumber,
        reviewed_at: nowIso(),
        artifact_version: artifact?.metadata?.version || null,
        ...(target === 'implementation'
          ? {
              implementation_status:
                artifact?.metadata?.implementation_status || null,
            }
          : {}),
        decision,
        can_accept: canAccept,
        mechanical: {
          valid: blocking.length === 0,
          blocking_count: blocking.length,
          findings,
        },
        semantic: {
          complete: semantic.complete,
          missing: semantic.missing,
          failed: semantic.failed,
        },
        warnings: nonBlocking,
      };

      reviewDoc.rounds.push(round);
      reviewDoc.metadata = {
        ...reviewDoc.metadata,
        artifact: cfg.artifact,
        target,
        latest_round: roundNumber,
        latest_decision: decision,
        updated: today(),
      };

      writeYamlAtomic(reviewPath, reviewDoc);
      recordedRound = roundNumber;
    }

    const debug = args.debug
      ? {
          contract: cfg.contract,
          artifact: artifactPath,
          review_file: reviewPath,
          findings_count: findings.length,
          blocking_count: blocking.length,
          semantic_missing: semantic.missing,
          semantic_failed: semantic.failed,
        }
      : undefined;

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
          artifact_status: artifact?.metadata?.[cfg.status_field] || null,
          blocking_count: blocking.length,
          blocking_findings: blocking,
          semantic_complete: semantic.complete,
          semantic_missing: semantic.missing,
          semantic_failed: semantic.failed,
          round: recordedRound,
          ...(debug ? { _debug: debug } : {}),
        },
        errors,
        warnings: nonBlocking,
      },
      EXIT.ok
    );
  } catch (err) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions: err.message,
        data: {
          target,
          target_artifact: cfg.artifact,
          change_root: changeRoot,
        },
        errors: [
          {
            code: 'INTERNAL_ERROR',
            message: err.message,
          },
        ],
        warnings: [],
      },
      EXIT.internal
    );
  }
}
