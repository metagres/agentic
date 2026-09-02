import fs from 'node:fs';
import path from 'node:path';

import { parseArgs, writeJson, EXIT, CWD_FLAG_DOC } from '../cli.ts';
import { changesDirFor, resolveRootOrError, ResolveRootError } from '../resolve-root.ts';
import { writeYamlAtomic, readStdin, parseYamlString, readYaml } from '../yaml-io.ts';
import { safeReadYaml, loadReviewReport } from '../context.ts';
import { loadDocsIndex, headingExists } from '../docs-index.ts';
import { today, slugify, uniqueSlug, nextIdsFromArrays, validateChangeSlug } from '../ids.ts';
import { bumpVersion } from '../semver.ts';
import { titleFromRequest, baseVersion, normalizeDeltaEntries } from '../stage-helpers.ts';
import { loadStepDefinitions, evaluatePredicate } from '../steps-loader.ts';
import { detectStep, isReadyForReview, getData } from '../authoring-base.ts';
import type { AuthorEnv } from '../authoring-base.ts';
import { loadStageHooks, stagePreconditionWarnings } from '../stage-registry.ts';
import { validateArtifact } from '../validate.ts';
import { evaluateGate } from '../requires-graph.ts';
import { makeError } from '../error-catalog.ts';
import type { StageRecord } from '../stage-registry.ts';
import type { ParseArgsResult, WarningItem, Finding } from '../types.ts';

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

function listExistingChanges(cwd: string) {
  const changesDir = changesDirFor(cwd);
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
        change_name: name,
        title: (meta.title as string) || name,
        stage: (meta.stage as string) || null,
        status: (meta.status as string) || 'unknown',
        version: (meta.version as string) || null,
      };
    });
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Instantiates an artifact from the stage's template.yaml with variable
 * substitution (FLW-002): title, dates, request summary, and predecessor
 * version tokens (based_on_requirements / based_on_design).
 */
function instantiateArtifact(
  stage: StageRecord,
  request: string,
  changeRoot: string
): Record<string, unknown> {
  if (!stage.files.template) {
    throw new Error(`Stage '${stage.id}' has no template.yaml to instantiate.`);
  }

  const doc = deepClone(readYaml(stage.files.template)) as Record<string, unknown>;
  const metadata = (doc.metadata || {}) as Record<string, unknown>;

  const title = `${stage.titlePrefix}${titleFromRequest(request, stage.titleDefault)}`;
  metadata.title = title;

  if ('request_summary' in metadata) {
    metadata.request_summary = String(request || '').trim();
  }
  if ('based_on_requirements' in metadata) {
    metadata.based_on_requirements = baseVersion(changeRoot, 'requirements.yaml');
  }
  if ('based_on_design' in metadata) {
    metadata.based_on_design = baseVersion(changeRoot, 'design.yaml');
  }
  if (metadata.created === 'YYYY-MM-DD') metadata.created = today();
  if (metadata.updated === 'YYYY-MM-DD') metadata.updated = today();

  metadata.status = 'draft';
  if (!metadata.version) metadata.version = '0.1.0';

  doc.metadata = metadata;
  return doc;
}

/**
 * Explicit-slug creation failure (TASK-001): --change plus --request with no
 * matching change directory creates the change under the exact provided name.
 * Carries the error code and the same candidates/available/searched details
 * as ResolveRootError so the blocked envelope mirrors the existing
 * AMBIGUOUS/available-changes machinery.
 */
export class ChangeSlugError extends Error {
  code: string;
  candidates: string[];
  available: string[];
  searched: string;

  constructor(
    code: string,
    message: string,
    details: { candidates?: string[]; available?: string[]; searched?: string } = {}
  ) {
    super(message);
    this.name = 'ChangeSlugError';
    this.code = code;
    this.candidates = details.candidates || [];
    this.available = details.available || [];
    this.searched = details.searched || '';
  }
}

export function createChangeDir(
  cwd: string,
  request: string,
  stage: StageRecord,
  explicitSlug?: string
): string {
  const changesDir = changesDirFor(cwd);

  let slug: string | undefined;

  if (explicitSlug !== undefined) {
    // Explicit-slug creation (TASK-001): the change is created under the exact
    // provided name. Validation runs before anything is written; a collision
    // with an existing change directory is rejected naming the candidates.
    const problem = validateChangeSlug(explicitSlug);
    if (problem) {
      throw new ChangeSlugError('INVALID_CHANGE_SLUG', problem, { searched: changesDir });
    }
    slug = explicitSlug;
  }

  fs.mkdirSync(changesDir, { recursive: true });

  const existing = fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (slug !== undefined) {
    if (existing.includes(slug)) {
      const sorted = [...existing].sort();
      const shown = sorted.slice(0, 10).join(', ');
      const more = sorted.length > 10 ? ` (and ${sorted.length - 10} more)` : '';
      throw new ChangeSlugError(
        'CHANGE_DIR_EXISTS',
        `Change '${slug}' already exists; refusing to create a duplicate. Available changes: ${shown}${more}`,
        { candidates: [slug], available: sorted, searched: changesDir }
      );
    }
  } else {
    slug = uniqueSlug(slugify(request), existing);
  }

  const root = path.join(changesDir, slug);
  fs.mkdirSync(root, { recursive: true });

  const artifact = instantiateArtifact(stage, request, root);
  writeYamlAtomic(path.join(root, stage.artifact), artifact);

  return root;
}

function saveArtifact(env: AuthorEnv): void {
  if (!env.artifactPath || !env.artifact) return;
  writeYamlAtomic(env.artifactPath, env.artifact);
}

function ensureArtifact(env: AuthorEnv): void {
  if (!env.changeRoot) {
    throw new Error('A change is required. Use --change or --request.');
  }

  if (!env.artifact) {
    env.artifact = instantiateArtifact(
      env.stage,
      (env.args.request as string) || path.basename(env.changeRoot),
      env.changeRoot
    );
    saveArtifact(env);
  }
}

function markMutated(env: AuthorEnv): void {
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

function mergeArtifact(
  existing: Record<string, unknown>,
  input: Record<string, unknown>,
  stage: StageRecord
): Record<string, unknown> {
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

  if (existingMeta.status) meta.status = existingMeta.status;
  if (existingMeta.version) meta.version = existingMeta.version;
  if (existingMeta.created) meta.created = existingMeta.created;

  meta.updated = today();

  out.metadata = meta;
  return out;
}

function applyUpdateArtifact(env: AuthorEnv): void {
  const raw = readStdin();
  if (!raw.trim()) {
    throw new Error('--update-artifact requires YAML on stdin.');
  }

  const input = parseYamlString(raw, 'stdin') as Record<string, unknown>;

  const base: Record<string, unknown> =
    env.artifact ||
    instantiateArtifact(
      env.stage,
      (env.args.request as string) ||
        (env.changeRoot ? path.basename(env.changeRoot) : 'change'),
      env.changeRoot || env.cwd
    );

  const merged = mergeArtifact(base, input, env.stage);

  // Delta arrays piped through --update-artifact normalize identically to
  // --append-delta (API-003): phase defaults from the stage delta phase and
  // date defaults to today.
  if (Array.isArray(merged.delta)) {
    merged.delta = normalizeDeltaEntries(merged.delta as unknown[], env.stage);
  }

  env.artifact = merged;
  markMutated(env);
}

/**
 * Batch discovery recording (--record-answers <file>, TASK-009): reads a YAML
 * array of { lens, question, answer } entries and routes each one through the
 * exact same validation/allocation path as --record-answer by invoking the
 * stage's recordAnswer hook per entry with per-entry args. DL ids allocate
 * sequentially because every entry appends to the same artifact. Failures name
 * the offending entry index; nothing is persisted unless every entry applies
 * (the caller saves only after this loop returns).
 */
export function recordAnswersBatch(env: AuthorEnv): void {
  const hooks = env.hooks as Record<string, unknown> | null;
  const recordAnswer = hooks?.recordAnswer as ((e: AuthorEnv) => void) | undefined;
  if (typeof recordAnswer !== 'function') {
    throw new Error(`--record-answers is not supported by stage '${env.stage.id}'.`);
  }

  const file = String(env.args['record-answers'] || '');
  if (!file.trim()) {
    throw new Error('--record-answers requires a file path.');
  }

  if (!fs.existsSync(file)) {
    throw new Error(`--record-answers file not found: ${file}`);
  }

  const doc = readYaml(file) as unknown;
  if (!Array.isArray(doc)) {
    throw new Error(
      `--record-answers file must contain a YAML array of { lens, question, answer } entries: ${file}`
    );
  }

  doc.forEach((raw: unknown, idx: number) => {
    const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (!entry) {
      throw new Error(
        `--record-answers entry ${idx} must be an object with lens, question, and answer.`
      );
    }

    // A shallow env copy sharing the artifact: the hook validates and allocates
    // exactly as it does for the singular flag, appending to the same log.
    const entryEnv: AuthorEnv = {
      ...env,
      args: {
        ...env.args,
        lens: entry.lens,
        question: entry.question,
        answer: entry.answer,
      },
    };

    try {
      recordAnswer(entryEnv);
    } catch (err: unknown) {
      throw new Error(
        `--record-answers entry ${idx} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}

function appendDelta(env: AuthorEnv): void {
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
  const allowed = new Set(docs.map((d) => d.file));

  if (docs.length === 0) {
    env.warnings.push({
      code: 'DOCS_INDEX_MISSING',
      message:
        'docs/current/index.md not found; delta target validation was skipped.',
    });
  }

  const validated: Record<string, unknown>[] = [];

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

    validated.push(entry);
  });

  const normalized = normalizeDeltaEntries(validated, env.stage);

  const artifact = env.artifact as Record<string, unknown>;

  if (!Array.isArray(artifact.delta)) {
    artifact.delta = [];
  }

  (artifact.delta as Record<string, unknown>[]).push(...normalized);
  markMutated(env);
}

function completeStep(env: AuthorEnv): void {
  const step = env.args.step as string | undefined;

  const meta = (env.artifact as Record<string, unknown>).metadata as Record<string, unknown>;

  if (step === 'assumptions') {
    meta.assumptions_reviewed = true;
  } else if (step === 'delta') {
    meta.delta_reviewed = true;
  } else if (step === 'init') {
    meta.context_loaded = true;
  } else if (step === 'discovery') {
    meta.discovery_reviewed = true;
  } else if (step === 'scenarios') {
    meta.scenarios_reviewed = true;
  } else {
    throw new Error(`Cannot manually complete step '${String(step)}'.`);
  }

  markMutated(env);
}

function semanticChecksFor(env: AuthorEnv): string[] {
  const stage = env.stage;
  if (!stage.files.semanticChecks) return [];
  const doc = readYaml(stage.files.semanticChecks) as { checks?: unknown } | null;
  return Array.isArray(doc?.checks) ? (doc.checks as unknown[]).filter((c) => typeof c === 'string') as string[] : [];
}

function blockingFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => !f.severity || f.severity === 'blocking');
}

function finalizeArtifact(env: AuthorEnv): void {
  const stage = env.stage;
  const findings = validateArtifact(stage.id, env.artifact, env.cwd, env.changeRoot);

  if (findings.length > 0) {
    const blocking = blockingFindings(findings);
    throw new Error(
      `Cannot finalize. Fix the following structural/reference errors:\n - ${blocking.map((f) => f.finding).join('\n - ')}`
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
  meta.updated = today();
}

function describeWorkflow(stage: StageRecord) {
  const stepDefinitions = loadStepDefinitions(stage) || {};
  return {
    workflow: stage.id,
    step: 'describe',
    state: 'ok',
    instructions: `Workflow description for ${stage.id}.`,
    data: {
      artifact: stage.artifact,
      steps: Object.keys(stepDefinitions),
      step_definitions: stepDefinitions,
    },
    errors: [],
    warnings: [],
  };
}

function describeStep(stage: StageRecord, stepId: string, cwd: string) {
  const stepDefinitions = loadStepDefinitions(stage) || {};
  const stepIds = Object.keys(stepDefinitions);
  const step = stepDefinitions?.[stepId];

  const vars = {
    SDLC: cliInvocation(cwd),
    change_name: '<change-name>',
    stage: stage.id,
  };

  if (!step) {
    return {
      workflow: stage.id,
      step: 'describe_step',
      state: 'blocked',
      instructions: `Unknown step: ${stepId}. Known steps: ${stepIds.join(', ')}.`,
      data: {
        requested_step: stepId,
        known_steps: stepIds,
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
  const commands = (step.commands || []).map((command) => renderTemplate(command, vars));
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

function helpPayload(stage: StageRecord) {
  const stepDefinitions = loadStepDefinitions(stage) || {};
  const stepIds = Object.keys(stepDefinitions);
  const usage = [
    `sdlc ${stage.id} --change <change-name>`,
    `sdlc ${stage.id} --request "<request>"`,
    `sdlc ${stage.id} --change <change-name> --next-ids`,
    `sdlc ${stage.id} --change <change-name> --update-artifact < ${stage.artifact}`,
    `sdlc ${stage.id} --change <change-name> --append-delta < delta.yaml`,
    `sdlc ${stage.id} --change <change-name> --complete-step --step <step>`,
    `sdlc ${stage.id} --change <change-name> --finalize [--confirm-semantic]`,
    `sdlc ${stage.id} --describe`,
    `sdlc ${stage.id} --describe-step <step>`,
  ];

  return {
    workflow: stage.id,
    step: 'help',
    state: 'ok',
    instructions: [
      `Usage: sdlc ${stage.id} --change <change-name>`,
      ``,
      `Available ${stage.id} commands:`,
      ...usage.map((command) => `  ${command}`),
      ``,
      CWD_FLAG_DOC,
    ].join('\n'),
    data: {
      artifact: stage.artifact,
      steps: stepIds,
      usage,
    },
    errors: [],
    warnings: [],
  };
}

export async function runAuthoringStage(
  stage: StageRecord,
  argv: string[],
  cwd: string
): Promise<void> {
  const args = parseArgs(argv) as ParseArgsResult;

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
    if (args.change) {
      try {
        changeRoot = resolveRootOrError(String(args.change), { cwd });
      } catch (err: unknown) {
        if (!(err instanceof ResolveRootError)) throw err;

        // Explicit-slug creation (TASK-001): --change plus --request with no
        // matching change directory creates the change under the exact
        // provided name, after slug validation and the uniqueness check.
        if (args.request && err.candidates.length === 0) {
          try {
            changeRoot = createChangeDir(
              cwd,
              String(args.request),
              stage,
              String(args.change)
            );
          } catch (createErr: unknown) {
            if (!(createErr instanceof ChangeSlugError)) throw createErr;
            writeJson(
              {
                workflow: stage.id,
                step: 'needs_input',
                state: 'blocked',
                instructions: createErr.message,
                data: {
                  requested_change: String(args.change),
                  candidates: createErr.candidates,
                  available_changes: createErr.available || [],
                  searched: createErr.searched || undefined,
                },
                errors: [
                  {
                    code: createErr.code,
                    message: createErr.message,
                    ...(createErr.available.length > 0
                      ? {
                          fix: 'Use one of data.available_changes as --change (the exact name or a unique part of it), or pick a different name.',
                        }
                      : {}),
                  },
                ],
                warnings,
              },
              EXIT.usage
            );
            return;
          }
          // Creation succeeded: continue with the normal flow below.
        } else {
          writeJson(
            {
              workflow: stage.id,
              step: 'needs_input',
              state: 'blocked',
              instructions: err.message,
              data: {
                existing_changes: listExistingChanges(cwd),
                candidates: err.candidates,
                available_changes: err.available || [],
                searched: err.searched || undefined,
              },
              errors: [
                {
                  code: err.candidates.length > 0 ? 'AMBIGUOUS_CHANGE_DIR' : 'CHANGE_DIR_NOT_FOUND',
                  message: err.message,
                  candidates: err.candidates,
                  ...(err.available.length > 0
                    ? { fix: 'Use one of data.available_changes as --change (the exact name or a unique part of it).' }
                    : {}),
                },
              ],
              warnings,
            },
            EXIT.ambiguous
          );
          return;
        }
      }
    } else if (args.request) {
      changeRoot = createChangeDir(cwd, String(args.request), stage);
    }

    const artifactPath = changeRoot ? path.join(changeRoot, stage.artifact) : null;

    let artifact: Record<string, unknown> | null = artifactPath
      ? (safeReadYaml(artifactPath) as Record<string, unknown> | null)
      : null;

    if (changeRoot && !artifact) {
      artifact = instantiateArtifact(
        stage,
        (args.request as string) || path.basename(changeRoot),
        changeRoot
      );
      writeYamlAtomic(artifactPath!, artifact);
      warnings.push({
        code: 'ARTIFACT_INITIALIZED',
        message: `Created ${stage.artifact} in ${changeRoot}.`,
      });
    }

    const hooks = await loadStageHooks(stage);

    const env: AuthorEnv = {
      args,
      cwd,
      changeRoot,
      artifactPath,
      artifact,
      stage,
      warnings,
      hooks,
      readYaml: safeReadYaml,
    };

    // Optional stage startup hook (DEC-002): stage-specific configuration
    // loading that runs before any command executes. Thrown coded errors
    // surface as blocked envelopes through the catch below via err.code.
    if (hooks && typeof hooks.startup === 'function') {
      (hooks.startup as (e: AuthorEnv) => void)(env);
    }

    if (args['next-ids']) {
      ensureArtifact(env);
      writeJson(
        {
          workflow: stage.id,
          step: 'next_ids',
          state: 'ok',
          instructions: 'Use data.next_ids when adding new items to the artifact.',
          data: {
            change_root: changeRoot,
            artifact: artifactPath,
            next_ids: nextIdsFromArrays(env.artifact || {}, stage.nextIds),
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
      if (!hooks || typeof hooks.recordAnswer !== 'function') {
        throw new Error(`--record-answer is not supported by stage '${stage.id}'.`);
      }
      ensureArtifact(env);
      (hooks.recordAnswer as (e: AuthorEnv) => void)(env);
      markMutated(env);
      saveArtifact(env);
    }

    if (args['record-answers']) {
      ensureArtifact(env);
      recordAnswersBatch(env);
      markMutated(env);
      saveArtifact(env);
    }

    if (args['set-clarity']) {
      if (!hooks || typeof hooks.setClarity !== 'function') {
        throw new Error(`--set-clarity is not supported by stage '${stage.id}'.`);
      }
      ensureArtifact(env);
      (hooks.setClarity as (e: AuthorEnv) => void)(env);
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

      // Acceptance gate (DEC-008): the stage is runnable only when every
      // required stage's tracked artifact is accepted.
      const gate = evaluateGate(stage, changeRoot as string, env.cwd);
      if (!gate.satisfied) {
        writeJson(
          {
            workflow: stage.id,
            step: 'blocked',
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
            warnings,
          },
          EXIT.actionFailed
        );
        return;
      }

      const findings = validateArtifact(stage.id, env.artifact, env.cwd, env.changeRoot);

      if (findings.length > 0) {
        const blocking = blockingFindings(findings);

        writeJson(
          {
            workflow: stage.id,
            step: 'recovery',
            state: 'blocked',
            instructions:
              'Fix the following structural/reference errors:\n - ' +
              blocking.map((f) => f.finding).join('\n - '),
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

      const stageChecks = semanticChecksFor(env);

      if (stageChecks.length > 0 && !args['confirm-semantic']) {
        const checklist = stageChecks.map((c, i) => `${i + 1}. ${c}`).join('\n');

        writeJson(
          {
            workflow: stage.id,
            step: 'semantic_review',
            state: 'in_progress',
            instructions:
              `Structural validation passed. Before finalizing, manually verify the following semantic checks against your artifact:\n\n${checklist}\n\n` +
              `If any check fails, fix the artifact and run validate again. If all pass, run: sdlc ${stage.id} --change <change-name> --finalize --confirm-semantic`,
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

    // Recalculate state for standard output.
    const findings = validateArtifact(stage.id, env.artifact, env.cwd, env.changeRoot);
    const blocking = blockingFindings(findings);

    const stepEnv: AuthorEnv = {
      ...env,
      findings,
      blocking,
    };

    const stepDefinitions = loadStepDefinitions(stage) || {};
    const step = changeRoot ? detectStep(stepEnv) : 'needs_input';
    const stepDef = stepDefinitions?.[step] || {};

    const cli = cliInvocation(cwd);
    const changeDir = changeRoot ? path.basename(changeRoot) : '<change-name>';

    const templateVars = {
      SDLC: cli,
      change_name: changeDir,
      stage: stage.id,
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
    const hookWarnings = await stagePreconditionWarnings(stage, stepEnv);
    const allWarnings: WarningItem[] = [...warnings, ...hookWarnings];

    const data: Record<string, unknown> = {
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
    };

    if (step === 'needs_input') {
      data.existing_changes = listExistingChanges(cwd);
    } else if (step === 'authoring') {
      data.next_ids = nextIdsFromArrays(env.artifact || {}, stage.nextIds);
      data.delta_allowed_target_docs = loadDocsIndex(cwd).map((doc) => doc.file);
    } else if (step === 'recovery') {
      data.errors = blocking;
    }

    Object.assign(data, getData(stepEnv));

    // Expose artifact metadata (e.g. based_on_design) in the envelope.
    data.metadata = (env.artifact?.metadata as Record<string, unknown>) || {};

    const state =
      step === 'complete'
        ? 'complete'
        : step === 'recovery' && blocking.length > 0
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
        workflow: stage.id,
        step,
        state,
        instructions,
        data: {
          ...data,
          // Opt-in step guidance (DEC-003): step_help dominates the payload
          // and is only included when the invocation carries --help-step.
          ...(args['help-step'] ? { step_help: stepHelp } : {}),
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
        workflow: stage.id,
        step: 'blocked',
        state: 'blocked',
        instructions: errMsg,
        data: changeRoot ? { change_root: changeRoot } : {},
        errors: [
          makeError(
            (err instanceof Error ? (err as NodeJS.ErrnoException).code : 'INTERNAL_ERROR') ||
              'INTERNAL_ERROR',
            { message: errMsg }
          ),
        ],
        warnings,
      },
      EXIT.internal
    );
  }
}
