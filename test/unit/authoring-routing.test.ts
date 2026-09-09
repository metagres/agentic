import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectStep } from '../../src/scripts/lib/authoring-base.ts';
import type { AuthorEnv } from '../../src/scripts/lib/authoring-base.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

// Minimal AuthorEnv over the shipped requirements steps.yaml: detectStep only
// reads changeRoot, artifact, findings, and stage.files.steps.
function makeEnv(overrides: {
  changeRoot?: string | null;
  artifact?: Record<string, unknown> | null;
  findings?: unknown[];
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
    findings: overrides.findings || [],
  } as AuthorEnv;
}

test('detectStep maps artifact state onto the six-step tour', () => {
  // No change root -> needs_input.
  assert.equal(detectStep(makeEnv({ changeRoot: null })), 'needs_input');

  // No artifact -> init.
  assert.equal(detectStep(makeEnv({ artifact: null })), 'init');

  // Created but context not loaded (init predicate unsatisfied) -> init.
  assert.equal(detectStep(makeEnv({ artifact: { metadata: {} } })), 'init');

  // Context loaded, discovery unconfirmed -> discovery.
  assert.equal(
    detectStep(
      makeEnv({ artifact: { metadata: { title: 'T', request_summary: 'R', context_loaded: true } } })
    ),
    'discovery'
  );

  // Discovery confirmed, draft with content still being authored -> authoring.
  assert.equal(
    detectStep(
      makeEnv({
        artifact: {
          metadata: { title: 'T', request_summary: 'R', context_loaded: true, discovery_reviewed: true },
          problem_statement: '',
        },
      })
    ),
    'authoring'
  );

  // Draft whose authoring predicate is satisfied -> ready.
  assert.equal(
    detectStep(
      makeEnv({
        artifact: {
          metadata: { title: 'T', request_summary: 'R', context_loaded: true, discovery_reviewed: true },
          problem_statement: 'P',
        },
      })
    ),
    'ready'
  );

  // Finalized -> complete; accepted stays complete.
  assert.equal(
    detectStep(
      makeEnv({
        artifact: {
          metadata: { title: 'T', request_summary: 'R', context_loaded: true, discovery_reviewed: true, status: 'ready-for-review' },
          problem_statement: 'P',
        },
      })
    ),
    'complete'
  );
  assert.equal(
    detectStep(
      makeEnv({
        artifact: {
          metadata: { title: 'T', request_summary: 'R', context_loaded: true, discovery_reviewed: true, status: 'accepted' },
          problem_statement: 'P',
        },
      })
    ),
    'complete'
  );

  // Rejected -> recovery.
  assert.equal(
    detectStep(
      makeEnv({
        artifact: {
          metadata: { title: 'T', request_summary: 'R', context_loaded: true, discovery_reviewed: true, status: 'rejected' },
          problem_statement: 'P',
        },
      })
    ),
    'recovery'
  );

  // Any mechanical finding -> recovery regardless of content (every finding
  // blocks by definition).
  assert.equal(
    detectStep(
      makeEnv({
        artifact: {
          metadata: { title: 'T', request_summary: 'R', context_loaded: true, discovery_reviewed: true },
          problem_statement: 'P',
        },
        findings: [{ finding: 'duplicate id' }],
      })
    ),
    'recovery'
  );
});

test('detectStep routes removed legacy step ids nowhere', () => {
  // The retired granular flags (scenarios/assumptions) must not route to
  // removed step ids; the discovery extra step routes only on its own flag.
  const step = detectStep(
    makeEnv({
      artifact: {
        metadata: { title: 'T', request_summary: 'R', clarity: 'vague', context_loaded: true, discovery_reviewed: true },
        problem_statement: 'P',
        discovery_log: [],
        assumptions: [],
      },
    })
  );
  assert.equal(step, 'ready');
});
