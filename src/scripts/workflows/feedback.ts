import path from 'node:path';
import { parseArgs, writeJson, EXIT, resolveCwd, CWD_FLAG_DOC } from '../lib/cli.ts';
import { writeYamlAtomic, readYaml } from '../lib/yaml-io.ts';
import { resolveRootOrError, ResolveRootError } from '../lib/resolve-root.ts';
import { today, nextId } from '../lib/ids.ts';
import { makeError } from '../lib/error-catalog.ts';
import { loadStageRegistry, getStageById } from '../lib/stage-registry.ts';
import type { StageRecord } from '../lib/stage-registry.ts';

/**
 * Computes the transitive downstream stages of a stage: every stage reachable
 * through requires and reviews edges (a stage depends on the acceptance of the
 * stages it requires and of the stage it reviews).
 */
function downstreamStageIds(stageId: string, registry: StageRecord[]): string[] {
  const adjacency = new Map<string, string[]>();
  for (const s of registry) adjacency.set(s.id, []);

  for (const s of registry) {
    for (const req of s.requires) {
      adjacency.get(req)?.push(s.id);
    }
    if (s.reviews) {
      adjacency.get(s.reviews)?.push(s.id);
    }
  }

  const visited = new Set<string>();
  const queue = [stageId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) || []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return [...visited];
}

function trackedStageOf(cwd: string, stage: StageRecord): StageRecord {
  if (stage.kind === 'review' && stage.reviews) {
    return getStageById(cwd, stage.reviews) || stage;
  }
  return stage;
}

function setTrackedStatus(
  cwd: string,
  changeRoot: string,
  stage: StageRecord,
  status: string
): void {
  const tracked = trackedStageOf(cwd, stage);
  const artifactPath = path.join(changeRoot, tracked.artifact);
  const artifact = readYaml(artifactPath) as any;

  if (!artifact) return;

  artifact.metadata = artifact.metadata || {};
  artifact.metadata[tracked.statusField] = status;
  writeYamlAtomic(artifactPath, artifact);
}

export function runFeedback(argv: string[]) {
  const args = parseArgs(argv);
  const cwd = resolveCwd(args);

  if (!args.change) {
    return writeJson({
      workflow: 'feedback',
      step: 'blocked',
      state: 'blocked',
      instructions: 'Usage: sdlc feedback --change <change-name> --from <stage> --to <stage> --reason "..." [--resolve <FB-id>] ' + CWD_FLAG_DOC,
      data: {},
      errors: [makeError('MISSING_CHANGE_DIR')],
      warnings: [],
    }, EXIT.usage);
  }

  let changeRoot;
  try {
    changeRoot = resolveRootOrError(String(args.change), { cwd });
  } catch (err: unknown) {
    if (err instanceof ResolveRootError) {
      return writeJson({
        workflow: 'feedback',
        step: 'blocked',
        state: 'blocked',
        instructions: err.message,
        data: {
          candidates: err.candidates || [],
          available_changes: err.available || [],
          searched: err.searched || undefined,
        },
        errors: [makeError(err.candidates.length > 0 ? 'AMBIGUOUS_CHANGE_DIR' : 'CHANGE_DIR_NOT_FOUND', {
          message: err.message,
          ...(err.available.length > 0
            ? { fix: 'Use one of data.available_changes as --change (the exact name or a unique part of it).' }
            : {}),
        })],
        warnings: [],
      }, EXIT.ambiguous);
    }
    throw err;
  }

  const feedbackPath = path.join(changeRoot, 'feedback.yaml');
  let feedbackDoc = readYaml(feedbackPath) as { entries?: any[] } | null || { entries: [] };
  if (!Array.isArray(feedbackDoc.entries)) feedbackDoc.entries = [];

  // Handle --resolve
  if (args.resolve) {
    const id = String(args.resolve);
    const entry = feedbackDoc.entries.find((e: any) => e.id === id);

    if (!entry) {
      return writeJson({
        workflow: 'feedback',
        step: 'blocked',
        state: 'blocked',
        instructions: `Feedback entry ${id} not found.`,
        data: { change_root: changeRoot },
        errors: [makeError('ENTRY_ID_NOT_FOUND', { message: `Feedback entry ${id} not found.` })],
        warnings: [],
      }, EXIT.actionFailed);
    }

    entry.status = 'resolved';
    entry.resolved_at = today();
    writeYamlAtomic(feedbackPath, feedbackDoc);

    // Unblock the 'from' stage so its work can resume.
    const fromStage = getStageById(cwd, entry.from_stage);
    if (fromStage) {
      setTrackedStatus(
        cwd,
        changeRoot,
        fromStage,
        fromStage.kind === 'tasks' ? 'in_progress' : 'draft'
      );
    }

    return writeJson({
      workflow: 'feedback',
      step: 'resolved',
      state: 'complete',
      instructions: `Feedback ${id} resolved. ${entry.from_stage} is now unblocked. Resume ${entry.from_stage} workflow.`,
      data: { change_root: changeRoot, resolved_id: id },
      errors: [],
      warnings: [],
    }, EXIT.ok);
  }

  // Handle new feedback creation
  if (!args.from || !args.to || !args.reason) {
    return writeJson({
      workflow: 'feedback',
      step: 'blocked',
      state: 'blocked',
      instructions: 'Usage: sdlc feedback --change <change-name> --from <stage> --to <stage> --reason "..." ' + CWD_FLAG_DOC,
      data: { change_root: changeRoot },
      errors: [makeError('USAGE', { message: 'Missing --from, --to, or --reason' })],
      warnings: [],
    }, EXIT.usage);
  }

  const from = String(args.from);
  const to = String(args.to);
  const reason = String(args.reason);

  const registry = loadStageRegistry(cwd);
  const fromStage = getStageById(cwd, from);
  const toStage = getStageById(cwd, to);

  if (!fromStage || !toStage) {
    return writeJson({
      workflow: 'feedback',
      step: 'blocked',
      state: 'blocked',
      instructions: `Invalid stage. Valid stages: ${registry.map((s) => s.id).join(', ')}`,
      data: { change_root: changeRoot },
      errors: [makeError('UNKNOWN_STAGE', { message: 'Invalid stage provided.' })],
      warnings: [],
    }, EXIT.usage);
  }

  // The target stage must precede the source stage in the requires graph.
  const downstream = downstreamStageIds(to, registry);
  if (!downstream.includes(from)) {
    return writeJson({
      workflow: 'feedback',
      step: 'blocked',
      state: 'blocked',
      instructions: `Cannot provide feedback from ${from} to ${to}. Target stage must precede source stage.`,
      data: { change_root: changeRoot },
      errors: [makeError('USAGE', { message: 'Target stage must precede source stage.' })],
      warnings: [],
    }, EXIT.usage);
  }

  // 1. Revert the target stage's artifact to draft.
  setTrackedStatus(cwd, changeRoot, toStage, 'draft');

  // 2. Block every downstream stage through the requires graph, so a revert
  //    cascades through unsatisfied gates.
  for (const id of downstream) {
    if (id === to) continue;
    const stage = getStageById(cwd, id);
    if (!stage) continue;
    setTrackedStatus(
      cwd,
      changeRoot,
      stage,
      stage.kind === 'tasks' ? 'pending' : 'blocked'
    );
  }

  // 3. Record feedback
  const id = nextId(feedbackDoc.entries.map((e: any) => e.id), 'FB');
  feedbackDoc.entries.push({
    id,
    from_stage: from,
    to_stage: to,
    reason,
    status: 'open',
    created_at: today(),
  });
  writeYamlAtomic(feedbackPath, feedbackDoc);

  return writeJson({
    workflow: 'feedback',
    step: 'created',
    state: 'complete',
    instructions: `Reverted ${to} to draft and blocked ${downstream.filter((d) => d !== to).join(', ') || 'none'}. Run scripts/sdlc.js ${to} --change <change-name> to resolve the issue, re-review, then run: sdlc feedback --change <change-name> --resolve ${id}`,
    data: {
      change_root: changeRoot,
      feedback_id: id,
      from_stage: from,
      to_stage: to,
    },
    errors: [],
    warnings: [],
  }, EXIT.ok);
}
