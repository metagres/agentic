import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectStep } from '../../src/scripts/lib/authoring-base.ts';
import type { AuthorEnv } from '../../src/scripts/lib/authoring-base.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

// Minimal AuthorEnv over the shipped requirements steps.yaml: detectStep only
// reads changeRoot, artifact, blocking, and stage.files.steps.
function makeEnv(overrides: {
  changeRoot?: string | null;
  artifact?: Record<string, unknown> | null;
  blocking?: unknown[];
}): AuthorEnv {
  return {
    args: {},
    cwd: root,
    changeRoot: overrides.changeRoot === undefined ? '/tmp/change' : overrides.changeRoot,
    artifactPath: null,
    artifact: overrides.artifact === undefined ? {} : overrides.artifact,
    stage: {
      id: 'requirements',
      files: { steps: path.join(root, 'src', 'stages', 'requirements', 'steps.yaml') },
    } as unknown as AuthorEnv['stage'],
    warnings: [],
    hooks: null,
    readYaml: () => null,
    blocking: overrides.blocking || [],
  } as AuthorEnv;
}

test('detectStep maps artifact state onto the six-step tour', () => {
  // No change root -> needs_input.
  assert.equal(detectStep(makeEnv({ changeRoot: null })), 'needs_input');

  // No artifact -> init.
  assert.equal(detectStep(makeEnv({ artifact: null })), 'init');

  // Created but empty (init predicate unsatisfied) -> init.
  assert.equal(detectStep(makeEnv({ artifact: { metadata: {} } })), 'init');

  // Draft with content still being authored -> authoring.
  assert.equal(
    detectStep(makeEnv({ artifact: { metadata: { title: 'T', request_summary: 'R' }, problem_statement: '' } })),
    'authoring'
  );

  // Draft whose authoring predicate is satisfied -> ready.
  assert.equal(
    detectStep(makeEnv({ artifact: { metadata: { title: 'T', request_summary: 'R' }, problem_statement: 'P' } })),
    'ready'
  );

  // Finalized -> complete; accepted stays complete.
  assert.equal(
    detectStep(makeEnv({ artifact: { metadata: { title: 'T', request_summary: 'R', status: 'ready-for-review' }, problem_statement: 'P' } })),
    'complete'
  );
  assert.equal(
    detectStep(makeEnv({ artifact: { metadata: { title: 'T', request_summary: 'R', status: 'accepted' }, problem_statement: 'P' } })),
    'complete'
  );

  // Rejected -> recovery.
  assert.equal(
    detectStep(makeEnv({ artifact: { metadata: { title: 'T', request_summary: 'R', status: 'rejected' }, problem_statement: 'P' } })),
    'recovery'
  );

  // Blocking mechanical findings -> recovery regardless of content.
  assert.equal(
    detectStep(
      makeEnv({
        artifact: { metadata: { title: 'T', request_summary: 'R' }, problem_statement: 'P' },
        blocking: [{ finding: 'duplicate id' }],
      })
    ),
    'recovery'
  );
});

test('detectStep ignores legacy granular confirmation flags for routing', () => {
  // discovery_reviewed / scenarios_reviewed / assumptions_reviewed unset must
  // not route to removed step ids.
  const step = detectStep(
    makeEnv({
      artifact: {
        metadata: { title: 'T', request_summary: 'R', clarity: 'vague' },
        problem_statement: 'P',
        discovery_log: [],
        assumptions: [],
      },
    })
  );
  assert.equal(step, 'ready');
});
