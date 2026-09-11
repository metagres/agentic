import fs from 'node:fs';
import path from 'node:path';

import { parseArgs, writeJson, EXIT, CWD_FLAG_DOC } from '../lib/cli.ts';
import { helpEnvelope, rejectUnknownFlags, CHANGES_FLAGS } from '../lib/help.ts';
import { changesDirFor } from '../lib/resolve-root.ts';
import { computePipelineOrder } from '../lib/requires-graph.ts';
import { getStageById } from '../lib/stage-registry.ts';
import { readStageStatus, trackedStage } from './status.ts';
import { safeReadYaml } from '../lib/context.ts';
import type { ParseArgsResult } from '../lib/types.ts';

function usage(code: number = EXIT.ok): void {
  if (code === EXIT.ok) {
    writeJson(
      helpEnvelope({
        command: 'changes',
        purpose:
          'Read-only inventory of every change with the stage to run next, its bound agent, the suggested command, and open feedback. Also the skill change-identification surface.',
        usage: ['sdlc changes'],
        flags: CHANGES_FLAGS,
      }),
      code
    );
    return;
  }

  writeJson(
    {
      command: 'changes',
      step: 'help',
      state: 'blocked',
      instructions: 'Usage: sdlc changes ' + CWD_FLAG_DOC,
      data: {},
      errors: [],
      warnings: [],
    },
    code
  );
}

/**
 * Read-only inventory (FR-004, FR-012): every docs/changes directory with the
 * first non-settled stage as the stage to run now, its bound agent, the
 * suggested command, and the open-feedback flag. The command never writes; it
 * is also the skill's change-identification surface.
 */
export function runChanges(argv: string[]): void {
  const args = parseArgs(argv) as ParseArgsResult;
  rejectUnknownFlags('changes', args, CHANGES_FLAGS);

  if (args.help) {
    usage(EXIT.ok);
    return;
  }

  const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
  const changesDir = changesDirFor(cwd);

  const entries = fs.existsSync(changesDir)
    ? fs
        .readdirSync(changesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

  const order = computePipelineOrder(cwd);

  const changes = entries.map((name) => {
    const changeRoot = path.join(changesDir, name);

    const feedbackDoc = safeReadYaml(path.join(changeRoot, 'feedback.yaml')) as {
      entries?: { id?: string; status?: string }[];
    } | null;
    const openFeedback = feedbackDoc?.entries?.find((entry) => entry.status === 'open');

    const unsettled = order.find((id) => {
      const stage = trackedStage(cwd, id);
      if (!stage) return false;
      const status = readStageStatus(cwd, changeRoot, id);
      return stage.kind === 'aggregator' ? status !== 'complete' : status !== 'accepted';
    });

    return {
      change_name: name,
      stage: unsettled || 'complete',
      agent: unsettled ? getStageById(cwd, unsettled)?.agent ?? null : null,
      suggested_command: unsettled ? `sdlc ${unsettled} --change ${name}` : null,
      open_feedback: openFeedback ? String(openFeedback.id) : null,
      // Selection state (DEC-001): only in_progress changes are selectable;
      // completed ones are archived.
      pipeline_state: unsettled ? 'in_progress' : 'complete',
    };
  });

  writeJson(
    {
      command: 'changes',
      step: 'inventory',
      state: 'ok',
      instructions:
        changes.length === 0
          ? 'No changes exist yet. Start one with: sdlc init --change <slug>.'
          : `${changes.length} change(s). Run sdlc status --change <name> for the full pipeline of one change.`,
      data: {
        changes,
      },
      errors: [],
      warnings: [],
    },
    EXIT.ok
  );
}
