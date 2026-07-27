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
import { runChecks } from './contract-checks.ts';
// sdlc-hardening: schema
import { validateArtifactSchema } from './schema.ts';
import {
  safeReadYaml,
  loadContract,
  requireContract,
  makeCtx,
  semanticSummary,
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
import { loadLifecycle, loadSemanticPolicy } from './policy-loader.ts';
import { assertTransition } from './lifecycle.ts';
import { makeError } from './error-catalog.ts';
import type { ErrorItem, ParseArgsResult, WarningItem, Finding, SemanticSummary, Ctx, StageDef, RunEnv, ChangeEntry } from './types.ts';

const STRICT_WARNING_CODES = [
  'DOCS_INDEX_MISSING',
  'PREVIOUS_STAGE_NOT_READY',
  'REQUIREMENTS_NOT_READY',
  'IMPLEMENTATION_NOT_ACCEPTED',
  'DOCS_DELTA_VALIDATION'
];

function strictModeErrors(warnings: WarningItem[], semantic: SemanticSummary | undefined, step: string): ErrorItem[] {
  const errs = (warnings || [])
    .filter((w) => w && w.code && STRICT_WARNING_CODES.includes(w.code))
    .map((w) => makeError(w.code, { message: w.message }));

  if (
    semantic &&
    semantic.complete === false &&
    ['validation', 'ready', 'recovery', 'complete'].includes(step)
  ) {
    errs.push(
      makeError('SEMANTIC_NOT_COMPLETE', {
        message: 'Semantic validation is not complete.'
      })
    );
  }

  return errs;
}

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

function recordSemanticResult(env: RunEnv): void {
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

  const artifact = env.artifact as Record<string, unknown>;

  if (!Array.isArray(artifact.semantic_validation)) {
    artifact.semantic_validation = [];
  }

  const sv = artifact.semantic_validation as Record<string, unknown>[];

  const result: Record<string, unknown> = {
    check_id: checkId,
    status,
    evidence: String(evidence),
    evaluated_at: today(),
  };

  const idx = sv.findIndex(
    (r: Record<string, unknown>) => r.check_id === checkId
  );

  if (idx >= 0) {
    sv[idx] = result;
  } else {
    sv.push(result);
  }

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
  env.contract = requireContract(env.stage.contractFile, env.cwd, env.warnings);

  const semanticPolicy = loadSemanticPolicy(env.cwd) as Record<string, unknown> | undefined;
  const svPolicy = semanticPolicy?.semantic_validation as Record<string, unknown> | undefined;
  const minEvidenceChars = svPolicy?.default_min_evidence_chars;
  if (!(Number(minEvidenceChars) > 0)) {
    const err = new Error(
      'semantic-policy.yaml must define semantic_validation.default_min_evidence_chars as a positive number.'
    ) as NodeJS.ErrnoException;
    err.code = 'POLICY_INVALID';
    throw err;
  }

  const schemaFindings = validateArtifactSchema(env.stage.id, env.artifact, env.cwd);
  const findings = [
    ...schemaFindings,
    ...runChecks(env.artifact, env.contract || {} as Record<string, unknown>, env.ctx as unknown as Record<string, unknown>, {
      gate: 'finalize',
    }),
  ];
  const blocking = findings.filter((f: { severity: string }) => f.severity === 'blocking');
  const semantic: SemanticSummary = semanticSummary(
    (env.artifact || {}) as Record<string, unknown>,
    (env.contract || {}) as Record<string, unknown>,
    { minEvidenceChars }
  ) as SemanticSummary;

  const ready = (env.stage.isReadyForReview as ((env: Record<string, unknown>) => { ready: boolean; reasons: string[] }) | undefined)?.({
    ...env,
    artifact: env.artifact,
    findings,
    blocking,
    semantic,
  } as Record<string, unknown>);

  if (!ready || !ready.ready) {
    throw new Error(`Cannot finalize: ${ready?.reasons?.join('; ') || 'isReadyForReview returned not ready'}`);
  }

  const lifecycle = loadLifecycle(env.cwd) as Record<string, unknown>;
  const meta = (env.artifact as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
  const previousStatus = meta?.status as string | undefined;
  assertTransition(lifecycle, 'artifact_status', previousStatus, 'ready-for-review');

  let bumpKind = env.args['bump-version'] as string | undefined;
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

  const artifactMeta = (env.artifact as Record<string, unknown>).metadata as Record<string, unknown>;

  if (bumpKind) {
    artifactMeta.version = bumpVersion(
      (artifactMeta.version as string) || '0.1.0',
      bumpKind
    );
  }

  artifactMeta.status = 'ready-for-review';
  artifactMeta.step = 'complete';
  artifactMeta.updated = today();
}

function describeWorkflow(stage: StageDef): { workflow: string; step: string; state: string; instructions: string; data: Record<string, unknown>; errors: []; warnings: [] } {
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

function describeStep(stage: StageDef, stepId: string, cwd: string): { workflow: string; step: string; state: string; instructions: string; data: Record<string, unknown>; errors: { code: string; message: string }[]; warnings: string[] } {
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

function helpPayload(stage: StageDef): { workflow: string; step: string; state: string; instructions: string; data: Record<string, unknown>; errors: []; warnings: [] } {
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

export function runAuthoringStage(stageId: string, argv: string[]): void {
  const stage = stages[stageId as keyof typeof stages];

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

    let artifact: Record<string, unknown> | null = artifactPath ? safeReadYaml(artifactPath) as Record<string, unknown> | null : null;

    if (changeRoot && !artifact) {
      artifact = stage.initialArtifact(
        (args.request as string) || path.basename(changeRoot),
        {
          cwd,
          changeRoot,
        } as Record<string, unknown>
      );
      writeYamlAtomic(artifactPath!, artifact);
      warnings.push({
        code: 'ARTIFACT_INITIALIZED',
        message: `Created ${stage.artifactFile} in ${changeRoot}.`,
      });
    }

    const contract = loadContract(stage.contractFile, cwd, warnings);
    const ctx = makeCtx(cwd, changeRoot);

    const env: RunEnv = {
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

    const findings: { check: string; severity: string; category: string; target: string; finding: string; fix: string }[] = env.artifact
      ? runChecks(env.artifact, (env.contract || {}) as Record<string, unknown>, env.ctx as unknown as Record<string, unknown>, {
          gate: 'validation',
        })
      : [];

    const blocking = findings.filter((f: { severity: string }) => f.severity === 'blocking');
    const nonBlocking = findings.filter((f: { severity: string }) => f.severity !== 'blocking');
    const semantic: SemanticSummary = semanticSummary(
      (env.artifact || {}) as Record<string, unknown>,
      (env.contract || {}) as Record<string, unknown>
    ) as SemanticSummary;

    const stepEnv: Record<string, unknown> = {
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
const allWarnings: WarningItem[] = [...nonBlocking as unknown as WarningItem[], ...warnings, ...preconditionWarnings];
const strictErrors = args.strict ? strictModeErrors(allWarnings, semantic, step) : [];

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
      semantic_checks_to_run: ((contract?.semantic_checks || []) as Record<string, unknown>[]).map(
        (check: Record<string, unknown>) => ({
          id: check.id,
          severity: check.severity,
          category: check.category,
          description: check.description,
        })
      ),
      delta_allowed_target_docs: loadDocsIndex(cwd).map((doc: { file: string }) => doc.file),
      next_ids:
        env.artifact && stage.nextIds ? stage.nextIds((env.artifact || {}) as Record<string, unknown>) : {},
      review_report: reviewReport,
      ...(stage.getData ? stage.getData(stepEnv as Record<string, unknown>) : {}),
    };

let state =
step === 'complete'
    ? 'complete'
    : step === 'recovery'
      ? (blocking.length > 0 || !semantic.complete ? 'blocked' : 'in_progress')
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
if (strictErrors.length > 0) {
  state = 'blocked';
  instructions =
    `Strict mode is enabled and ${strictErrors.length} warning(s) are blocking.
` +
    strictErrors.map((e) => `- ${e.code}: ${e.message}`).join('\n');
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
        errors: strictErrors,
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
        data: changeRoot
          ? {
              change_root: changeRoot,
            }
          : {},
        errors: [makeError((err instanceof Error ? (err as NodeJS.ErrnoException).code : 'INTERNAL_ERROR') || 'INTERNAL_ERROR', { message: errMsg })],
warnings,
},
EXIT.internal
    );
  }
}