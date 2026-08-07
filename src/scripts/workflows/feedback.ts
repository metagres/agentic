import path from 'node:path';
import { parseArgs, writeJson, EXIT } from '../lib/cli.ts';
import { writeYamlAtomic, readYaml } from '../lib/yaml-io.ts';
import { resolveRootOrError, ResolveRootError } from '../lib/resolve-root.ts';
import { today, nextId } from '../lib/ids.ts';
import { makeError } from '../lib/error-catalog.ts';

const PIPELINE_ORDER = ['requirements', 'design', 'planning', 'implementation', 'knowledge-extraction'];

export function runFeedback(argv: string[]) {
  const args = parseArgs(argv);
  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();

  if (!args.dir) {
    return writeJson({
      workflow: 'feedback',
      step: 'blocked',
      state: 'blocked',
      instructions: 'Usage: sdlc feedback --dir <change-dir> --from <stage> --to <stage> --reason "..." [--resolve <FB-id>]',
      data: {},
      errors: [makeError('MISSING_CHANGE_DIR')],
      warnings: [],
    }, EXIT.usage);
  }

  let changeRoot;
  try {
    changeRoot = resolveRootOrError(String(args.dir), { cwd });
  } catch (err: unknown) {
    if (err instanceof ResolveRootError) {
      return writeJson({
        workflow: 'feedback',
        step: 'blocked',
        state: 'blocked',
        instructions: err.message,
        data: { candidates: err.candidates || [] },
        errors: [makeError(err.candidates.length > 0 ? 'AMBIGUOUS_CHANGE_DIR' : 'CHANGE_DIR_NOT_FOUND', { message: err.message })],
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

    // Unblock the 'from' artifact
    const fromFileMap: Record<string, string> = { requirements: 'requirements.yaml', design: 'design.yaml', planning: 'plan.yaml', implementation: 'plan.yaml' };
    const fromFile = fromFileMap[entry.from_stage];
    
    if (fromFile) {
      const fromArtifactPath = path.join(changeRoot, fromFile);
      const fromArtifact = readYaml(fromArtifactPath) as any;
      if (fromArtifact) {
        fromArtifact.metadata = fromArtifact.metadata || {};
        if (entry.from_stage === 'implementation') {
          fromArtifact.metadata.implementation_status = 'in_progress';
        } else {
          fromArtifact.metadata.status = 'draft'; // Resume work
        }
        writeYamlAtomic(fromArtifactPath, fromArtifact);
      }
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
      instructions: 'Usage: sdlc feedback --dir <change-dir> --from <stage> --to <stage> --reason "..."',
      data: { change_root: changeRoot },
      errors: [makeError('USAGE', { message: 'Missing --from, --to, or --reason' })],
      warnings: [],
    }, EXIT.usage);
  }

  const from = String(args.from);
  const to = String(args.to);
  const reason = String(args.reason);

  if (!PIPELINE_ORDER.includes(from) || !PIPELINE_ORDER.includes(to)) {
    return writeJson({
      workflow: 'feedback',
      step: 'blocked',
      state: 'blocked',
      instructions: `Invalid stage. Valid stages: ${PIPELINE_ORDER.join(', ')}`,
      data: { change_root: changeRoot },
      errors: [makeError('UNKNOWN_STAGE', { message: 'Invalid stage provided.' })],
      warnings: [],
    }, EXIT.usage);
  }

  if (PIPELINE_ORDER.indexOf(to) >= PIPELINE_ORDER.indexOf(from)) {
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

  const toFileMap: Record<string, string> = { requirements: 'requirements.yaml', design: 'design.yaml', planning: 'plan.yaml' };
  const fromFileMap: Record<string, string> = { requirements: 'requirements.yaml', design: 'design.yaml', planning: 'plan.yaml', implementation: 'plan.yaml' };

  const toFile = toFileMap[to];
  const fromFile = fromFileMap[from];

  if (!toFile || !fromFile) {
    return writeJson({
      workflow: 'feedback',
      step: 'blocked',
      state: 'blocked',
      instructions: 'Feedback can only be applied to requirements, design, or planning artifacts.',
      data: { change_root: changeRoot },
      errors: [makeError('USAGE', { message: 'Invalid artifact mapping.' })],
      warnings: [],
    }, EXIT.usage);
  }

  // 1. Revert target artifact to draft
  const toArtifactPath = path.join(changeRoot, toFile);
  const toArtifact = readYaml(toArtifactPath) as any;
  if (toArtifact) {
    toArtifact.metadata = toArtifact.metadata || {};
    toArtifact.metadata.status = 'draft';
    writeYamlAtomic(toArtifactPath, toArtifact);
  }

  // 2. Block source artifact
  const fromArtifactPath = path.join(changeRoot, fromFile);
  const fromArtifact = readYaml(fromArtifactPath) as any;
  if (fromArtifact) {
    fromArtifact.metadata = fromArtifact.metadata || {};
    if (from === 'implementation') {
      fromArtifact.metadata.implementation_status = 'pending';
    } else {
      fromArtifact.metadata.status = 'blocked';
    }
    writeYamlAtomic(fromArtifactPath, fromArtifact);
  }

  // 3. Record feedback
  const id = nextId(feedbackDoc.entries.map((e: any) => e.id), 'FB');
  feedbackDoc.entries.push({
    id,
    from_stage: from,
    to_stage: to,
    reason,
    status: 'open',
    created_at: today()
  });
  writeYamlAtomic(feedbackPath, feedbackDoc);

  return writeJson({
    workflow: 'feedback',
    step: 'created',
    state: 'complete',
    instructions: `Reverted ${to} to draft and blocked ${from}. Please switch to the ${to}-authoring skill, resolve the issue, and re-review. Once accepted, run: sdlc feedback --dir <change-dir> --resolve ${id}`,
    data: {
      change_root: changeRoot,
      feedback_id: id,
      from_stage: from,
      to_stage: to
    },
    errors: [],
    warnings: [],
  }, EXIT.ok);
}