import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTHORING_FLAGS,
  REVIEW_FLAGS,
  TASKS_FLAGS,
  AGGREGATOR_FLAGS,
  STATUS_FLAGS,
  CHANGES_FLAGS,
  FEEDBACK_FLAGS,
  DOCTOR_FLAGS,
} from '../../src/scripts/lib/help.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const COMMAND_SOURCES: [string, Record<string, unknown>][] = [
  ['src/scripts/lib/kinds/authoring.ts', AUTHORING_FLAGS],
  ['src/scripts/lib/kinds/review.ts', REVIEW_FLAGS],
  ['src/scripts/lib/kinds/tasks.ts', TASKS_FLAGS],
  ['src/scripts/lib/kinds/aggregator.ts', AGGREGATOR_FLAGS],
  ['src/scripts/workflows/status.ts', STATUS_FLAGS],
  ['src/scripts/workflows/changes.ts', CHANGES_FLAGS],
  ['src/scripts/workflows/feedback.ts', FEEDBACK_FLAGS],
  ['src/scripts/workflows/doctor.ts', DOCTOR_FLAGS],
];

// The global exemptions of the closed vocabulary: the positional sink, the
// help flag (exempt in rejectUnknownFlags), and the global --cwd.
const GLOBAL_FLAGS = new Set(['_', 'help', 'cwd']);

function parsedFlagReads(source: string): Set<string> {
  const reads = new Set<string>();
  const pattern = /\bargs(?:\['([a-z][a-z0-9-]*)'\]|\.([a-z][a-z0-9]+))\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    reads.add(match[1] || match[2]);
  }
  return reads;
}

test('every parsed flag of every command is documented in its flags map', () => {
  const problems: string[] = [];

  for (const [relPath, table] of COMMAND_SOURCES) {
    const source = fs.readFileSync(path.join(root, relPath), 'utf8');
    for (const flag of parsedFlagReads(source)) {
      if (GLOBAL_FLAGS.has(flag)) continue;
      if (!(flag in (table as Record<string, unknown>))) {
        problems.push(`${relPath}: flag '${flag}' is parsed but missing from its flags map`);
      }
    }
  }

  assert.deepEqual(problems, []);
});

test('every flags map entry carries a description and a value shape', () => {
  for (const [relPath, table] of COMMAND_SOURCES) {
    for (const [flag, doc] of Object.entries(table as Record<string, { description?: string; value?: string }>)) {
      assert.ok(
        doc.description && doc.description.trim().length > 0,
        `${relPath}: flag '${flag}' has no description`
      );
      assert.ok(
        doc.value && doc.value.trim().length > 0,
        `${relPath}: flag '${flag}' has no value shape`
      );
    }
  }
});

test('every command exposes cwd in its rendered flags map', async () => {
  const { helpEnvelope } = await import('../../src/scripts/lib/help.ts');
  const envelope = helpEnvelope({
    command: 'probe',
    purpose: 'probe',
    usage: ['sdlc probe'],
    flags: {},
  });
  assert.ok(envelope.data.flags.cwd, '--cwd must render in every flags map');
});
