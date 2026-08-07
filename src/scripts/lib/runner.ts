import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, writeJson, EXIT } from './cli.ts';
import {
  resolveRootOrError,
  ResolveRootError,
} from './resolve-root.ts';
import {
  writeYamlAtomic,
  readStdin,
  parseYamlString,
} from './yaml-io.ts';
// sdlc-hardening: schema
import { validateArtifactSchema } from './schema.ts';
import {
  safeReadYaml,
  loadContract,
  makeCtx,
  loadReviewReport,
} from './context.ts';
import {
  loadDocsIndex,
  headingExists,
} from './docs-index.ts';
import { today, slugify, uniqueSlug } from './ids.ts';
import { bumpVersion } from './semver.ts';
import { requirementsStage } from '../workflows/requirements.ts';
import { designStage } from '../workflows/design.ts';
import { planningStage } from '../workflows/planning.ts';
import { loadSemanticChecks } from './policy-loader.ts';
import { checkCrossFileReferences } from './validators.ts';
import { makeError } from './error-catalog.ts';
import type { ParseArgsResult, WarningItem, Finding, StageDef, RunEnv, ChangeEntry } from './types.ts';

const stages: Record<string, StageDef> = {
  requirements: requirementsStage as unknown as StageDef,
  design: designStage as unknown as StageDef,
  planning: planningStage as unknown as StageDef,
};

function renderTemplate(text: string, vars: Record<string, string>): string {
  return String(text || '').replace(/{{(\w+)}}/g, (_, key) =>
    vars[key] !== undefined ? vars[key] : `{{${key}}}`
  );
}

function cliInvocation(cwd: string): string {
  const scriptPath = path.resolve(process.argv[1] || '');
  if (!scriptPath) {
    return 'node src/scripts/sdlc.ts';
  }
  const rel = path.relative(cwd, scriptPath);
  return `node ${rel || scriptPath}`;
}

function listExistingChanges(cwd: string): ChangeEntry[] {
  const changesDir = path.join(cwd, 'docs', 'changes');
  if (!fs.existsSync(changesDir)) return [];

  return fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const name = entry.name;
      const dir = path.join(changesDir, name);

      const requirements = safeReadYaml(path.join(dir, 'requirements.yaml')) as Record<string, unknown> | null;
      const design = safeReadYaml(path.join(dir, 'design.yaml')) as Record<string, unknown> | null;
      const plan = safeReadYaml(path.join(dir, 'plan.yaml')) as Record<string, unknown> | null;
      const artifact = requirements || design || plan;

      const meta = (artifact?.metadata as Record<string, unknown> | undefined) || {};

      return {
        dir: name,
        title: (meta.title as string) || name,
        stage: (meta.stage as string) || null,
        status: (meta.status as string) || 'unknown',
        version: (meta.version as string) || null,
      };
    });
}

function createChangeDir(cwd: string, request: string, stage: StageDef): string {
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

function saveArtifact(env: RunEnv): void {
  if (!env.artifactPath || !env.artifact) return;
  writeYamlAtomic(env.artifactPath, env.artifact);
}

function ensureArtifact(env: RunEnv): void {
  if (!env.changeRoot) {
    throw new Error('A change directory is required. Use --dir or --request.');
  }

  if (!env.artifact) {
    env.artifact = env.stage.initialArtifact(
      (env.args.request as string) || path.basename(env.changeRoot),
      env as unknown as Record<string, unknown>
    );
    saveArtifact(env);
  }
}

function markMutated(env: RunEnv): void {
  const artifact = env.artifact as Record<string, unknown>;
  if (!artifact.metadata) artifact.metadata = {};
  const meta = artifact.metadata as Record<string, unknown>;

  if (env.args['keep-status']) {
    meta.updated = today();
    return;
  }

  const status = meta.status as string | undefined;

  if (status === 'rejected') {
    // Keep rejected until finalize passes again.
  } else if (status === 'draft') {
    // Keep draft.
  } else {
    meta.status = 'draft';
  }

  meta.updated = today();
}

function mergeArtifact(existing: Record<string, unknown>, input: Record<string, unknown>, stage: StageDef): Record<string, unknown> {
  const out = {
    ...existing,
    ...input,
  } as Record<string, unknown>;

  const existingMeta = (existing?.metadata as Record<string, unknown> | undefined) || {};
  const inputMeta = (input?.metadata as Record<string, unknown> | undefined) || {};

  const meta: Record<string, unknown> = {
    ...existingMeta,
    ...inputMeta,
  };

  meta.stage = stage.id;

  if (existingMeta.status) {
    meta.status = existingMeta.status;
  }

  if (existingMeta.version) {
    meta.version = existingMeta.version;
  }

  if (existingMeta.created) {
    meta.created = existingMeta.created;
  }

  meta.updated = today();

  out.metadata = meta;

  return out;
}

function applyUpdateArtifact(env: RunEnv): void {
  const raw = readStdin();
  if (!raw.trim()) {
    throw new Error('--update-artifact requires YAML on stdin.');
  }

  const input = parseYamlString(raw, 'stdin') as Record<string, unknown>;

  const base: Record<string, unknown> =
    env.artifact ||
    env.stage.initialArtifact(
      (env.args.request as string) ||
        (env.changeRoot ? path.basename(env.changeRoot) : 'change'),
      env as unknown as Record<string, unknown>
    );

  env.artifact = mergeArtifact(base, input, env.stage);
  markMutated(env);
}

function appendDelta(env: RunEnv): void {
  const raw = readStdin();
  if (!raw.trim()) {
    throw new Error('--append-delta requires YAML on stdin.');
  }

  const parsed = parseYamlString(raw, 'stdin') as Record<string, unknown>;
  const entries: unknown = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>)?.delta;

  if (!Array.isArray(entries)) {
    throw new Error('Expected a YAML array or an object with a delta array.');
  }

  const docs = loadDocsIndex(env.cwd);
  const allowed = new Set(docs.map((d: { file: string }) => d.file));

  if (docs.length === 0) {
    env.warnings.push({
      code: 'DOCS_INDEX_MISSING',
      message:
        'docs/current/index.md not found; delta target validation was skipped.',
    });
  }

  const normalized: Record<string, unknown>[] = [];

  entries.forEach((entryRaw: unknown, idx: number) => {
    const entry = entryRaw as Record<string, unknown>;
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Delta entry ${idx} must be an object.`);
    }

    if (!entry.target_doc || typeof entry.target_doc !== 'string') {
      throw new Error(`Delta entry ${idx} requires target_doc.`);
    }

    if (!['Add', 'Modify', 'Remove'].includes(entry.change as string)) {
      throw new Error(`Delta entry ${idx} change must be Add, Modify, or Remove.`);
    }

    if (!entry.reason || String(entry.reason).trim().length < 10) {
      throw new Error(`Delta entry ${idx} requires a specific reason.`);
    }

    if (entry.date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date as string)) {
      throw new Error(`Delta entry ${idx} date must be YYYY-MM-DD.`);
    }

    if (allowed.size > 0 && !allowed.has(entry.target_doc as string)) {
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
        if (!headingExists(env.cwd, entry.target_doc as string, entry.target_anchor as string)) {
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

  const artifact = env.artifact as Record<string, unknown>;

  if (!Array.isArray(artifact.delta)) {
    artifact.delta = [];
  }

  (artifact.delta as Record<string, unknown>[]).push(...normalized);
  markMutated(env);
}

function completeStep(env: RunEnv): void {
  let step = env.args.step;

  if (!step) {
    step = env.stage.detectStep({
      ...env,
      blocking: [],
      semantic: { complete: false },
    } as Record<string, unknown>);
  }

  const meta = (env.artifact as Record<string, unknown>).metadata as Record<string, unknown>;

  if (step === 'assumptions') {
    meta.assumptions_reviewed = true;
  } else if (step === 'delta') {
    meta.delta_reviewed = true;
  } else if (step === 'init') {
    meta.context_loaded = true;
  } else {
    throw new Error(`Cannot manually complete step '${step}'.`);
  }

  markMutated(env);
}

function finalizeArtifact(env: RunEnv): void {
  const schemaFindings = validateArtifactSchema(env.stage.id, env.artifact, env.cwd);
  const refFindings = checkCrossFileReferences(env.stage.id, env.artifact as Record<string, unknown>, env.changeRoot!);
  const findings = [...schemaFindings, ...refFindings];

  if (findings.length > 0) {
    throw new Error(
      `Cannot finalize. Fix the following structural/reference errors:\n - ${findings.map(f => f.finding || (f as any).message).join('\n - ')}`
    );
  }

  const meta = (env.artifact as Record<string, unknown>).metadata as Record<string, unknown>;
  
  let bumpKind = env.args['bump-version'] as string | undefined;
  if (bumpKind && !['major', 'minor', 'patch'].includes(bumpKind)) {
    throw new Error('--bump-version must be major, minor, or patch.');
  }

  if (!bumpKind) {
    if (meta.status === 'rejected') {
      bumpKind = 'patch';
    } else if (meta.status === 'accepted') {
      bumpKind = 'minor';
    }
  }

  if (bumpKind) {
    meta.version = bumpVersion((meta.version as string) || '0.1.0', bumpKind);
  }

  meta.status = 'ready-for-review';
  meta.step = 'complete';
  meta.updated = today();
}

function describeWorkflow(stage: StageDef) {
  return {
    workflow: stage.id,
    step: 'describe',
    state: 'ok',
    instructions: `Workflow description for ${stage.id}.`,
    data: {
      artifact: stage.artifactFile,
      steps: stage.stepIds,
      step_definitions: stage.stepDefinitions,
    },
    errors: [],
    warnings: [],
  };
}

function describeStep(stage: StageDef, stepId: string, cwd: string) {
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
      instructions: `Unknown step: ${stepId}. Known steps: ${stage.stepIds.join(', ')}.`,
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

function helpPayload(stage: StageDef) {
  const usage = [
    `sdlc ${stage.id} --dir <change-dir>`,
    `sdlc ${stage.id} --request "<request>"`,
    `sdlc ${stage.id} --dir <change-dir> --next-ids`,
    `sdlc ${stage.id} --dir <change-dir> --update-artifact < ${stage.artifactFile}`,
    `sdlc ${stage.id} --dir <change-dir> --append-delta < delta.yaml`,
    `sdlc ${stage.id} --dir <change-dir> --complete-step --step <step>`,
    `sdlc ${stage.id} --dir <change-dir> --finalize [--confirm-semantic]`,
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
      steps: stage.stepIds,
      usage,
    },
    errors: [],
    warnings: [],
  };
}

export function runAuthoringStage(stageId: string, argv: string[]): void {
  const stage = stages[stageId as keyof typeof stages];

  if (!stage) {
    writeJson(
      {
        workflow: stageId,
        step: 'blocked',
        state: 'blocked',
        instructions: `Unknown stage: ${stageId}. Available stages: ${Object.keys(stages).join(', ')}.`,
        data: { known_stages: Object.keys(stages) },
        errors: [{ code: 'UNKNOWN_STAGE', message: `Unknown stage: ${stageId}` }],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  const args = parseArgs(argv) as ParseArgsResult;
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

  const warnings: WarningItem[] = [];
  let changeRoot: string | null = null;

  try {
    if (args.dir) {
      try {
        changeRoot = resolveRootOrError(String(args.dir), { cwd });
      } catch (err: unknown) {
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
                  code: err.candidates.length > 0 ? 'AMBIGUOUS_CHANGE_DIR' : 'CHANGE_DIR_NOT_FOUND',
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

    let artifact: Record<string, unknown> | null = artifactPath ? safeReadYaml(artifactPath) as Record<string, unknown> | null : null;

    if (changeRoot && !artifact) {
      artifact = stage.initialArtifact(
        (args.request as string) || path.basename(changeRoot),
        { cwd, changeRoot } as Record<string, unknown>
      );
      writeYamlAtomic(artifactPath!, artifact);
      warnings.push({
        code: 'ARTIFACT_INITIALIZED',
        message: `Created ${stage.artifactFile} in ${changeRoot}.`,
      });
    }

    const ctx = makeCtx(cwd, changeRoot);

    const env: RunEnv = {
      args,
      cwd,
      changeRoot,
      artifactPath,
      artifact,
      contract: null, // No longer used
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
          instructions: 'Use data.next_ids when adding new items to the artifact.',
          data: {
            change_root: changeRoot,
            artifact: artifactPath,
            next_ids: stage.nextIds ? stage.nextIds((env.artifact || {}) as Record<string, unknown>) : {},
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
      stage.recordAnswer(env as unknown as Record<string, unknown>);
      markMutated(env);
      saveArtifact(env);
    }

    if (args['set-clarity']) {
      if (!stage.setClarity) {
        throw new Error(`--set-clarity is not supported by stage '${stageId}'.`);
      }
      ensureArtifact(env);
      stage.setClarity(env as unknown as Record<string, unknown>);
      markMutated(env);
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
      
      const schemaFindings = validateArtifactSchema(env.stage.id, env.artifact, env.cwd);
      const refFindings = checkCrossFileReferences(env.stage.id, env.artifact as Record<string, unknown>, env.changeRoot!);
      const findings = [...schemaFindings, ...refFindings];

      if (findings.length > 0) {
        const blocking = findings.map(f => ({ check: 'validation', severity: 'blocking', category: 'structural', target: 'doc', finding: f.finding || (f as any).message, fix: 'Fix the error' }));
        
        writeJson(
          {
            workflow: stageId,
            step: 'validation',
            state: 'blocked',
            instructions: 'Fix the following structural/reference errors:\n - ' + findings.map(f => f.finding || (f as any).message).join('\n - '),
            data: {
              change_root: changeRoot,
              errors: blocking,
            },
            errors: [],
            warnings,
          },
          EXIT.ok
        );
        return;
      }

      const allSemanticChecks = loadSemanticChecks(env.cwd);
      const stageChecks = allSemanticChecks[stageId] || [];

      if (stageChecks.length > 0 && !args['confirm-semantic']) {
        const checklist = stageChecks.map((c, i) => `${i + 1}. ${c}`).join('\n');
        
        writeJson(
          {
            workflow: stageId,
            step: 'semantic_review',
            state: 'in_progress',
            instructions: 
              `Structural validation passed. Before finalizing, manually verify the following semantic checks against your artifact:\n\n${checklist}\n\n` +
              `If any check fails, fix the artifact and run validate again. If all pass, run: sdlc ${stageId} --dir <dir> --finalize --confirm-semantic`,
            data: {
              change_root: changeRoot,
              semantic_checks: stageChecks,
            },
            errors: [],
            warnings,
          },
          EXIT.ok
        );
        return;
      }

      finalizeArtifact(env);
      saveArtifact(env);
    }

    // Recalculate state for standard output
    const schemaFindings = env.artifact
      ? validateArtifactSchema(env.stage.id, env.artifact, env.cwd)
      : [];
    const refFindings = env.artifact && env.changeRoot
      ? checkCrossFileReferences(env.stage.id, env.artifact as Record<string, unknown>, env.changeRoot)
      : [];
    const findings = [...schemaFindings, ...refFindings];

    const blocking = findings.map(f => ({ check: 'validation', severity: 'blocking', category: 'structural', target: 'doc', finding: f.finding || (f as any).message, fix: 'Fix the error' })) as unknown as Finding[];
    
    const stepEnv: Record<string, unknown> = {
      ...env,
      artifact: env.artifact,
      findings,
      blocking,
      semantic: { complete: true, missing: [], failed: [], results: [] }, // Mocked for step detection
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
    const renderedCommands = (stepDef.commands || []).map((command: string) =>
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
      ? stage.preconditionWarnings(stepEnv as Record<string, unknown>)
      : [];

    const allWarnings: WarningItem[] = [...warnings, ...preconditionWarnings];

    // LEAN DATA ENVELOPE: Only include what is strictly necessary for the current step
    const data: Record<string, unknown> = {
      change_root: changeRoot,
      artifact: artifactPath,
      cli,
      runtime: {
        cli_path: cli.replace(/^node\s+/, ''),
        templates: path.posix.join(path.dirname(cli.replace(/^node\s+/, '')) || '.', '..', 'templates'),
      },
    };

    if (step === 'needs_input') {
      data.existing_changes = listExistingChanges(cwd);
    } else if (step === 'drafting' || step === 'discovery' || step === 'assumptions') {
      data.next_ids = env.artifact && stage.nextIds ? stage.nextIds((env.artifact || {}) as Record<string, unknown>) : {};
    } else if (step === 'validation') {
      data.errors = blocking;
    } else if (step === 'delta') {
      data.delta_allowed_target_docs = loadDocsIndex(cwd).map((doc: { file: string }) => doc.file);
    }

    if (stage.getData) {
      Object.assign(data, stage.getData(stepEnv as Record<string, unknown>));
    }

    let state =
      step === 'complete'
        ? 'complete'
        : step === 'recovery'
          ? (blocking.length > 0 ? 'blocked' : 'in_progress')
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
          review_report: reviewReport,
        },
        errors: [],
        warnings: allWarnings,
      },
      EXIT.ok
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    writeJson(
      {
        workflow: stageId,
        step: 'blocked',
        state: 'blocked',
        instructions: errMsg,
        data: changeRoot ? { change_root: changeRoot } : {},
        errors: [makeError((err instanceof Error ? (err as NodeJS.ErrnoException).code : 'INTERNAL_ERROR') || 'INTERNAL_ERROR', { message: errMsg })],
        warnings,
      },
      EXIT.internal
    );
  }
}