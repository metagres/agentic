import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, writeJson, EXIT } from './cli.mjs';
import {
  resolveRootOrError,
  ResolveRootError,
} from './resolve-root.mjs';
import {
  writeYamlAtomic,
  readStdin,
  parseYamlString,
} from './yaml-io.mjs';
import { runChecks } from './contract-checks.mjs';
import {
  safeReadYaml,
  loadContract,
  makeCtx,
  semanticSummary,
  loadReviewReport,
} from './context.mjs';
import {
  loadDocsIndex,
  headingExists,
} from './docs-index.mjs';
import { today, slugify, uniqueSlug } from './ids.mjs';
import { bumpVersion } from './semver.mjs';
import { requirementsStage } from '../workflows/requirements.mjs';
import { designStage } from '../workflows/design.mjs';
import { planningStage } from '../workflows/planning.mjs';

const stages = {
  requirements: requirementsStage,
  design: designStage,
  planning: planningStage,
};

function renderTemplate(text, vars) {
  return String(text || '').replace(/{{(\w+)}}/g, (_, key) =>
    vars[key] !== undefined ? vars[key] : `{{${key}}}`
  );
}

function cliInvocation(cwd) {
  const scriptPath = path.resolve(process.argv[1] || '');
  if (!scriptPath) {
    return 'node src/scripts/sdlc.mjs';
  }
  const rel = path.relative(cwd, scriptPath);
  return `node ${rel || scriptPath}`;
}

function listExistingChanges(cwd) {
  const changesDir = path.join(cwd, 'docs', 'changes');
  if (!fs.existsSync(changesDir)) return [];

  return fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const name = entry.name;
      const dir = path.join(changesDir, name);

      const requirements = safeReadYaml(path.join(dir, 'requirements.yaml'));
      const design = safeReadYaml(path.join(dir, 'design.yaml'));
      const plan = safeReadYaml(path.join(dir, 'plan.yaml'));
      const artifact = requirements || design || plan;

      return {
        dir: name,
        title: artifact?.metadata?.title || name,
        stage: artifact?.metadata?.stage || null,
        status: artifact?.metadata?.status || 'unknown',
        version: artifact?.metadata?.version || null,
      };
    });
}

function createChangeDir(cwd, request, stage) {
  const changesDir = path.join(cwd, 'docs', 'changes');
  fs.mkdirSync(changesDir, { recursive: true });

  const existing = fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const slugBase = slugify(request);
  const slug = uniqueSlug(slugBase, existing);

  const root = path.join(changesDir, slug);
  fs.mkdirSync(root, { recursive: true });

  const artifact = stage.initialArtifact(request, {
    cwd,
    changeRoot: root,
  });

  writeYamlAtomic(path.join(root, stage.artifactFile), artifact);

  return root;
}

function saveArtifact(env) {
  if (!env.artifactPath || !env.artifact) return;
  writeYamlAtomic(env.artifactPath, env.artifact);
}

function ensureArtifact(env) {
  if (!env.changeRoot) {
    throw new Error('A change directory is required. Use --dir or --request.');
  }

  if (!env.artifact) {
    env.artifact = env.stage.initialArtifact(
      env.args.request || path.basename(env.changeRoot),
      env
    );
    saveArtifact(env);
  }
}

function markMutated(env) {
  const artifact = env.artifact;
  if (!artifact.metadata) artifact.metadata = {};

  if (env.args['keep-status']) {
    artifact.metadata.updated = today();
    return;
  }

  const status = artifact.metadata.status;

  if (status === 'rejected') {
    // Keep rejected until finalize passes again.
  } else if (status === 'draft') {
    // Keep draft.
  } else {
    artifact.metadata.status = 'draft';
  }

  artifact.metadata.updated = today();
}

function mergeArtifact(existing, input, stage) {
  const out = {
    ...existing,
    ...input,
  };

  out.metadata = {
    ...(existing?.metadata || {}),
    ...(input?.metadata || {}),
  };

  out.metadata.stage = stage.id;

  if (existing?.metadata?.status) {
    out.metadata.status = existing.metadata.status;
  }

  if (existing?.metadata?.version) {
    out.metadata.version = existing.metadata.version;
  }

  if (existing?.metadata?.created) {
    out.metadata.created = existing.metadata.created;
  }

  out.metadata.updated = today();

  return out;
}

function applyUpdateArtifact(env) {
  const raw = readStdin();
  if (!raw.trim()) {
    throw new Error('--update-artifact requires YAML on stdin.');
  }

  const input = parseYamlString(raw, 'stdin');

  const base =
    env.artifact ||
    env.stage.initialArtifact(
      env.args.request ||
        (env.changeRoot ? path.basename(env.changeRoot) : 'change'),
      env
    );

  env.artifact = mergeArtifact(base, input, env.stage);
  markMutated(env);
}

function recordSemanticResult(env) {
  const checkId = env.args.check;
  const status = env.args.status;
  const evidence = env.args.evidence;

  if (!checkId || typeof checkId !== 'string') {
    throw new Error('--record-semantic-result requires --check <check_id>.');
  }

  if (!status || typeof status !== 'string') {
    throw new Error(
      '--record-semantic-result requires --status <pass|fail|waived>.'
    );
  }

  if (!['pass', 'fail', 'waived'].includes(status)) {
    throw new Error('Semantic result status must be one of: pass, fail, waived.');
  }

  if (!evidence || String(evidence).trim().length < 20) {
    throw new Error('Semantic result evidence must be at least 20 characters.');
  }

  if (!Array.isArray(env.artifact.semantic_validation)) {
    env.artifact.semantic_validation = [];
  }

  const result = {
    check_id: checkId,
    status,
    evidence: String(evidence),
    evaluated_at: today(),
  };

  const idx = env.artifact.semantic_validation.findIndex(
    (r) => r.check_id === checkId
  );

  if (idx >= 0) {
    env.artifact.semantic_validation[idx] = result;
  } else {
    env.artifact.semantic_validation.push(result);
  }

  markMutated(env);
}

function appendDelta(env) {
  const raw = readStdin();
  if (!raw.trim()) {
    throw new Error('--append-delta requires YAML on stdin.');
  }

  const parsed = parseYamlString(raw, 'stdin');
  const entries = Array.isArray(parsed) ? parsed : parsed?.delta;

  if (!Array.isArray(entries)) {
    throw new Error('Expected a YAML array or an object with a delta array.');
  }

  const docs = loadDocsIndex(env.cwd);
  const allowed = new Set(docs.map((d) => d.file));

  if (docs.length === 0) {
    env.warnings.push({
      code: 'DOCS_INDEX_MISSING',
      message:
        'docs/current/index.md not found; delta target validation was skipped.',
    });
  }

  const normalized = [];

  entries.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Delta entry ${idx} must be an object.`);
    }

    if (!entry.target_doc || typeof entry.target_doc !== 'string') {
      throw new Error(`Delta entry ${idx} requires target_doc.`);
    }

    if (!['Add', 'Modify', 'Remove'].includes(entry.change)) {
      throw new Error(`Delta entry ${idx} change must be Add, Modify, or Remove.`);
    }

    if (!entry.reason || String(entry.reason).trim().length < 10) {
      throw new Error(`Delta entry ${idx} requires a specific reason.`);
    }

    if (entry.date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      throw new Error(`Delta entry ${idx} date must be YYYY-MM-DD.`);
    }

    if (allowed.size > 0 && !allowed.has(entry.target_doc)) {
      throw new Error(
        `Delta entry ${idx} target_doc is not listed in docs/current/index.md: ${entry.target_doc}`
      );
    }

    if (entry.change !== 'Add') {
      if (!entry.target_anchor && !entry.entity_id) {
        throw new Error(
          `Delta entry ${idx} Modify/Remove requires target_anchor or entity_id.`
        );
      }

      if (entry.target_anchor && allowed.size > 0) {
        if (!headingExists(env.cwd, entry.target_doc, entry.target_anchor)) {
          throw new Error(
            `Delta entry ${idx} target_anchor not found in ${entry.target_doc}: ${entry.target_anchor}`
          );
        }
      }
    }

    normalized.push({
      ...entry,
      phase: entry.phase || env.stage.deltaPhase,
      date: entry.date || today(),
    });
  });

  if (!Array.isArray(env.artifact.delta)) {
    env.artifact.delta = [];
  }

  env.artifact.delta.push(...normalized);
  markMutated(env);
}

function completeStep(env) {
  let step = env.args.step;

  if (!step) {
    step = env.stage.detectStep({
      ...env,
      blocking: [],
      semantic: { complete: false },
    });
  }

  if (step === 'assumptions') {
    env.artifact.metadata.assumptions_reviewed = true;
  } else if (step === 'delta') {
    env.artifact.metadata.delta_reviewed = true;
  } else if (step === 'init') {
    env.artifact.metadata.context_loaded = true;
  } else {
    throw new Error(`Cannot manually complete step '${step}'.`);
  }

  markMutated(env);
}

function finalizeArtifact(env) {
  const findings = runChecks(env.artifact, env.contract, env.ctx, {
    gate: 'finalize',
  });

  const blocking = findings.filter((f) => f.severity === 'blocking');
  const semantic = semanticSummary(env.artifact, env.contract);

  const ready = env.stage.isReadyForReview({
    ...env,
    findings,
    blocking,
    semantic,
  });

  if (!ready.ready) {
    throw new Error(`Cannot finalize: ${ready.reasons.join('; ')}`);
  }

  const previousStatus = env.artifact.metadata?.status;

  let bumpKind = env.args['bump-version'];
  if (bumpKind && !['major', 'minor', 'patch'].includes(bumpKind)) {
    throw new Error('--bump-version must be major, minor, or patch.');
  }

  if (!bumpKind) {
    if (previousStatus === 'rejected') {
      bumpKind = 'patch';
    } else if (previousStatus === 'accepted') {
      bumpKind = 'minor';
    }
  }

  if (bumpKind) {
    env.artifact.metadata.version = bumpVersion(
      env.artifact.metadata.version,
      bumpKind
    );
  }

  env.artifact.metadata.status = 'ready-for-review';
  env.artifact.metadata.step = 'complete';
  env.artifact.metadata.updated = today();
}

function describeWorkflow(stage) {
  return {
    workflow: stage.id,
    step: 'describe',
    state: 'ok',
    instructions: `Workflow description for ${stage.id}.`,
    data: {
      artifact: stage.artifactFile,
      contract: stage.contractFile,
      steps: stage.stepIds,
      step_definitions: stage.stepDefinitions,
    },
    errors: [],
    warnings: [],
  };
}

function describeStep(stage, stepId, cwd) {
  const step = stage.stepDefinitions?.[stepId];

  const vars = {
    SDLC: cliInvocation(cwd),
    change_dir: '<change-dir>',
    stage: stage.id,
  };

  if (!step) {
    return {
      workflow: stage.id,
      step: 'describe_step',
      state: 'blocked',
      instructions: `Unknown step: ${stepId}. Known steps: ${stage.stepIds.join(
        ', '
      )}.`,
      data: {
        requested_step: stepId,
        known_steps: stage.stepIds,
      },
      errors: [
        {
          code: 'UNKNOWN_STEP',
          message: `Unknown step: ${stepId}`,
        },
      ],
      warnings: [],
    };
  }

  const title = step.title || stepId;
  const markdown = renderTemplate(step.markdown || '', vars);
  const commands = (step.commands || []).map((command) =>
    renderTemplate(command, vars)
  );
  const exitCriteria = step.exit_criteria || null;

  return {
    workflow: stage.id,
    step: 'describe_step',
    state: 'ok',
    instructions: markdown || `Step description for ${stepId}.`,
    data: {
      requested_step: stepId,
      step_definition: {
        title,
        markdown,
        commands,
        exit_criteria: exitCriteria,
      },
    },
    errors: [],
    warnings: [],
  };
}

function helpPayload(stage) {
  const usage = [
    `sdlc ${stage.id} --dir <change-dir>`,
    `sdlc ${stage.id} --request "<request>"`,
    `sdlc ${stage.id} --dir <change-dir> --next-ids`,
    `sdlc ${stage.id} --dir <change-dir> --update-artifact < ${stage.artifactFile}`,
    `sdlc ${stage.id} --dir <change-dir> --record-semantic-result --check <id> --status pass --evidence "<evidence>"`,
    `sdlc ${stage.id} --dir <change-dir> --append-delta < delta.yaml`,
    `sdlc ${stage.id} --dir <change-dir> --complete-step --step <step>`,
    `sdlc ${stage.id} --dir <change-dir> --finalize [--bump-version patch|minor|major]`,
    `sdlc ${stage.id} --describe`,
    `sdlc ${stage.id} --describe-step <step>`,
  ];

  return {
    workflow: stage.id,
    step: 'help',
    state: 'ok',
    instructions: [
      `Usage: sdlc ${stage.id} --dir <change-dir>`,
      ``,
      `Available ${stage.id} commands:`,
      ...usage.map((command) => `  ${command}`),
    ].join('\n'),
    data: {
      artifact: stage.artifactFile,
      contract: stage.contractFile,
      steps: stage.stepIds,
      usage,
    },
    errors: [],
    warnings: [],
  };
}

export function runAuthoringStage(stageId, argv) {
  const stage = stages[stageId];

  if (!stage) {
    writeJson(
      {
        workflow: stageId,
        step: 'blocked',
        state: 'blocked',
        instructions: `Unknown stage: ${stageId}. Available stages: ${Object.keys(
          stages
        ).join(', ')}.`,
        data: {
          known_stages: Object.keys(stages),
        },
        errors: [
          {
            code: 'UNKNOWN_STAGE',
            message: `Unknown stage: ${stageId}`,
          },
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  const args = parseArgs(argv);
  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();

  if (args.help) {
    writeJson(helpPayload(stage), EXIT.ok);
    return;
  }

  if (args.describe) {
    writeJson(describeWorkflow(stage), EXIT.ok);
    return;
  }

  if (args['describe-step']) {
    const payload = describeStep(stage, String(args['describe-step']), cwd);
    writeJson(payload, payload.state === 'blocked' ? EXIT.usage : EXIT.ok);
    return;
  }

  const warnings = [];
  let changeRoot = null;

  try {
    if (args.dir) {
      try {
        changeRoot = resolveRootOrError(String(args.dir), { cwd });
      } catch (err) {
        if (err instanceof ResolveRootError) {
          writeJson(
            {
              workflow: stageId,
              step: 'needs_input',
              state: 'blocked',
              instructions: err.message,
              data: {
                existing_changes: listExistingChanges(cwd),
                candidates: err.candidates,
              },
              errors: [
                {
                  code:
                    err.candidates.length > 0
                      ? 'AMBIGUOUS_CHANGE_DIR'
                      : 'CHANGE_DIR_NOT_FOUND',
                  message: err.message,
                  candidates: err.candidates,
                },
              ],
              warnings,
            },
            EXIT.ambiguous
          );
          return;
        }

        throw err;
      }
    } else if (args.request) {
      changeRoot = createChangeDir(cwd, String(args.request), stage);
    }

    const artifactPath = changeRoot
      ? path.join(changeRoot, stage.artifactFile)
      : null;

    let artifact = artifactPath ? safeReadYaml(artifactPath) : null;

    if (changeRoot && !artifact) {
      artifact = stage.initialArtifact(
        args.request || path.basename(changeRoot),
        {
          cwd,
          changeRoot,
        }
      );
      writeYamlAtomic(artifactPath, artifact);
      warnings.push({
        code: 'ARTIFACT_INITIALIZED',
        message: `Created ${stage.artifactFile} in ${changeRoot}.`,
      });
    }

    const contract = loadContract(stage.contractFile, cwd, warnings);
    const ctx = makeCtx(cwd, changeRoot);

    const env = {
      args,
      cwd,
      changeRoot,
      artifactPath,
      artifact,
      contract,
      ctx,
      stage,
      warnings,
    };

    if (args['next-ids']) {
      ensureArtifact(env);
      writeJson(
        {
          workflow: stageId,
          step: 'next_ids',
          state: 'ok',
          instructions:
            'Use data.next_ids when adding new items to the artifact.',
          data: {
            change_root: changeRoot,
            artifact: artifactPath,
            next_ids: stage.nextIds ? stage.nextIds(env.artifact) : {},
          },
          errors: [],
          warnings,
        },
        EXIT.ok
      );
      return;
    }

    if (args['update-artifact']) {
      ensureArtifact(env);
      applyUpdateArtifact(env);
      saveArtifact(env);
    }

    if (args['record-answer']) {
      if (!stage.recordAnswer) {
        throw new Error(`--record-answer is not supported by stage '${stageId}'.`);
      }

      ensureArtifact(env);
      stage.recordAnswer(env);
      markMutated(env);
      saveArtifact(env);
    }

    if (args['set-clarity']) {
      if (!stage.setClarity) {
        throw new Error(`--set-clarity is not supported by stage '${stageId}'.`);
      }

      ensureArtifact(env);
      stage.setClarity(env);
      markMutated(env);
      saveArtifact(env);
    }

    if (args['record-semantic-result']) {
      ensureArtifact(env);
      recordSemanticResult(env);
      saveArtifact(env);
    }

    if (args['append-delta']) {
      ensureArtifact(env);
      appendDelta(env);
      saveArtifact(env);
    }

    if (args['complete-step']) {
      ensureArtifact(env);
      completeStep(env);
      saveArtifact(env);
    }

    if (args.finalize) {
      ensureArtifact(env);
      finalizeArtifact(env);
      saveArtifact(env);
    }

    const findings = env.artifact
      ? runChecks(env.artifact, env.contract, env.ctx, {
          gate: 'validation',
        })
      : [];

    const blocking = findings.filter((f) => f.severity === 'blocking');
    const nonBlocking = findings.filter((f) => f.severity !== 'blocking');
    const semantic = semanticSummary(env.artifact, env.contract);

    const stepEnv = {
      ...env,
      artifact: env.artifact,
      findings,
      blocking,
      semantic,
    };

    const step = changeRoot ? stage.detectStep(stepEnv) : 'needs_input';
    const stepDef = stage.stepDefinitions?.[step] || {};

    const cli = cliInvocation(cwd);
    const changeDir = changeRoot ? path.basename(changeRoot) : '<change-dir>';

    const templateVars = {
      SDLC: cli,
      change_dir: changeDir,
      stage: stageId,
    };

    const renderedMarkdown = renderTemplate(stepDef.markdown || '', templateVars);
    const renderedCommands = (stepDef.commands || []).map((command) =>
      renderTemplate(command, templateVars)
    );

    const stepHelp = {
      title: stepDef.title || step,
      markdown: renderedMarkdown,
      commands: renderedCommands,
      exit_criteria: stepDef.exit_criteria || null,
    };

    const reviewReport = loadReviewReport(changeRoot);

    const preconditionWarnings = stage.preconditionWarnings
      ? stage.preconditionWarnings(stepEnv)
      : [];

    const data = {
      change_root: changeRoot,
      artifact: artifactPath,
      cli,
      runtime: {
        cli_path: cli.replace(/^node\s+/, ''),
        templates: path.posix.join(
          path.dirname(cli.replace(/^node\s+/, '')) || '.',
          '..',
          'templates'
        ),
      },
      existing_changes:
        step === 'needs_input' ? listExistingChanges(cwd) : [],
      validate_mechanical_valid: blocking.length === 0,
      validate_errors: blocking,
      semantic,
      semantic_checks_to_run: (contract?.semantic_checks || []).map(
        (check) => ({
          id: check.id,
          severity: check.severity,
          category: check.category,
          description: check.description,
        })
      ),
      delta_allowed_target_docs: loadDocsIndex(cwd).map((doc) => doc.file),
      next_ids:
        env.artifact && stage.nextIds ? stage.nextIds(env.artifact) : {},
      review_report: reviewReport,
      ...(stage.getData ? stage.getData(stepEnv) : {}),
    };

    const state =
      step === 'complete'
        ? 'complete'
        : step === 'recovery'
          ? 'blocked'
          : step === 'validation' && blocking.length > 0
            ? 'blocked'
            : 'in_progress';

    let instructions = renderedMarkdown;

    if (!instructions) {
      instructions = `Current step: ${step}.`;
    }

    if (state === 'blocked' && blocking.length > 0) {
      instructions = [
        'Fix blocking validation errors before continuing.',
        '',
        instructions,
      ]
        .join('\n')
        .trim();
    }

    writeJson(
      {
        workflow: stageId,
        step,
        state,
        instructions,
        data: {
          ...data,
          step_help: stepHelp,
        },
        errors: [],
        warnings: [...nonBlocking, ...warnings, ...preconditionWarnings],
      },
      EXIT.ok
    );
  } catch (err) {
    writeJson(
      {
        workflow: stageId,
        step: 'blocked',
        state: 'blocked',
        instructions: err.message,
        data: changeRoot
          ? {
              change_root: changeRoot,
            }
          : {},
        errors: [
          {
            code: 'INTERNAL_ERROR',
            message: err.message,
          },
        ],
        warnings,
      },
      EXIT.internal
    );
  }
}