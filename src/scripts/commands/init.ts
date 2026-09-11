import fs from 'node:fs';
import path from 'node:path';

import { parseArgs, writeJson, EXIT, resolveCwd, CWD_FLAG_DOC } from '../lib/cli.ts';
import { helpEnvelope, rejectUnknownFlags, INIT_FLAGS } from '../lib/help.ts';
import { changesDirFor } from '../lib/resolve-root.ts';
import { validateChangeSlug } from '../lib/ids.ts';
import { ChangeSlugError } from '../lib/kinds/authoring.ts';
import type { ParseArgsResult, WarningItem } from '../lib/types.ts';

function usage(code: number = EXIT.ok): void {
  if (code === EXIT.ok) {
    writeJson(
      helpEnvelope({
        command: 'init',
        purpose:
          'Create a new change directory (mkdir-only): validates the slug, refuses duplicates, seeds no artifact, and engages no stage.',
        usage: ['sdlc init --change <change-name>'],
        flags: INIT_FLAGS,
      }),
      code
    );
    return;
  }

  writeJson(
    {
      command: 'init',
      step: 'help',
      state: 'blocked',
      instructions: 'Usage: sdlc init --change <change-name> ' + CWD_FLAG_DOC,
      data: {},
      errors: [],
      warnings: [],
    },
    code
  );
}

/**
 * Blocked envelope for a ChangeSlugError (INVALID_CHANGE_SLUG or
 * CHANGE_DIR_EXISTS): mirrors the authoring rendering so both error codes
 * keep identical messages, data fields, and fix text. Nothing is created and
 * no suffixed variant is derived — creation is explicit (DEC-005).
 */
function slugErrorEnvelope(
  err: ChangeSlugError,
  requestedChange: string,
  warnings: WarningItem[]
): void {
  writeJson(
    {
      command: 'init',
      step: 'blocked',
      state: 'blocked',
      instructions: err.message,
      data: {
        requested_change: requestedChange,
        candidates: err.candidates,
        available_changes: err.available || [],
        searched: err.searched || undefined,
      },
      errors: [
        {
          code: err.code,
          message: err.message,
          ...(err.available.length > 0
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
}

/**
 * Orchestrator-owned change creation (FR-001): sdlc init --change <slug>
 * creates only the change directory docs/changes/<slug> (creating docs/changes
 * itself when absent). The slug is validated with validateChangeSlug
 * (INVALID_CHANGE_SLUG, nothing written) and an existing directory is refused
 * through the ChangeSlugError machinery (CHANGE_DIR_EXISTS, untouched, no
 * suffix). No request.md, no artifact seeding, no creation gate, no stage
 * engagement — init deliberately does not reuse createChangeDir, which
 * instantiates artifacts (DEC-005).
 */
export function runInit(argv: string[]): void {
  const args = parseArgs(argv) as ParseArgsResult;
  rejectUnknownFlags('init', args, INIT_FLAGS);

  if (args.help) {
    usage(EXIT.ok);
    return;
  }

  if (!args.change || typeof args.change !== 'string' || !args.change.trim()) {
    writeJson(
      {
        command: 'init',
        step: 'blocked',
        state: 'blocked',
        instructions:
          'Usage: sdlc init --change <change-name> ' + CWD_FLAG_DOC,
        data: {},
        errors: [
          {
            code: 'USAGE',
            message: 'The init command requires --change <change-name>.',
            fix: 'Pass the exact slug to create; creation is explicit and never fuzzy.',
          },
        ],
        warnings: [],
      },
      EXIT.usage
    );
    return;
  }

  const cwd = resolveCwd(args);
  const changesDir = changesDirFor(cwd);
  const slug = String(args.change);
  const warnings: WarningItem[] = [];

  // Slug validation runs before anything is written (FP-001).
  const problem = validateChangeSlug(slug);
  if (problem) {
    slugErrorEnvelope(
      new ChangeSlugError('INVALID_CHANGE_SLUG', problem, { searched: changesDir }),
      slug,
      warnings
    );
    return;
  }

  // Duplicate refusal (FP-002): the existing directory is untouched and no
  // suffixed variant is derived.
  const existing = fs.existsSync(changesDir)
    ? fs
        .readdirSync(changesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

  if (existing.includes(slug)) {
    const shown = existing.slice(0, 10).join(', ');
    const more = existing.length > 10 ? ` (and ${existing.length - 10} more)` : '';
    slugErrorEnvelope(
      new ChangeSlugError(
        'CHANGE_DIR_EXISTS',
        `Change '${slug}' already exists; refusing to create a duplicate. Available changes: ${shown}${more}`,
        { candidates: [slug], available: existing, searched: changesDir }
      ),
      slug,
      warnings
    );
    return;
  }

  // Mkdir-only creation: the change directory and, when absent, docs/changes
  // itself. No other file or directory is created.
  fs.mkdirSync(path.join(changesDir, slug), { recursive: true });

  writeJson(
    {
      command: 'init',
      step: 'init',
      state: 'ok',
      instructions:
        `Change '${slug}' created. Run the heartbeat: sdlc status --change ${slug} — and follow the envelope.`,
      data: {
        change_name: slug,
      },
      errors: [],
      warnings,
    },
    EXIT.ok
  );
}
