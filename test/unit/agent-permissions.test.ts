import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KIND_PERMISSION_CONTRACTS,
  computeEffectivePermissions,
  checkAgentCompatibility,
} from '../../src/scripts/lib/agent-permissions.ts';
import type {
  CompatibilityAgent,
  CompatibilityStage,
} from '../../src/scripts/lib/agent-permissions.ts';

// --- Fixture helpers --------------------------------------------------------

function stage(
  id: string,
  kind: string,
  agent: string | null,
  permissionOverrides: Record<string, string> = {}
): CompatibilityStage {
  return { id, kind, agent, permissionOverrides };
}

function agentDef(id: string, permissions: Record<string, string>): CompatibilityAgent {
  return { id, permissions };
}

/** Requirements/systems-architect/task-planner/knowledge-curator pattern. */
function analystPattern(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    file_read: 'allow',
    search: 'deny',
    file_write: 'allow',
    shell: 'allow',
    subagent: 'allow',
    web: 'deny',
    ...overrides,
  };
}

/** implementation-engineer pattern. */
function engineerPattern(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    file_read: 'allow',
    search: 'allow',
    file_write: 'allow',
    shell: 'allow',
    subagent: 'allow',
    web: 'deny',
    ...overrides,
  };
}

/** stage-reviewer pattern. */
function reviewerPattern(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    file_read: 'allow',
    search: 'allow',
    file_write: 'deny',
    shell: 'allow',
    subagent: 'deny',
    web: 'deny',
    ...overrides,
  };
}

/** The nine migrated stage bindings agreed in TASK-006. */
function nineStageBindings(): CompatibilityStage[] {
  return [
    stage('requirements', 'authoring', 'requirements-analyst'),
    stage('design', 'authoring', 'systems-architect'),
    stage('planning', 'authoring', 'task-planner'),
    stage('implementation', 'tasks', 'implementation-engineer'),
    stage('requirements-review', 'review', 'stage-reviewer'),
    stage('design-review', 'review', 'stage-reviewer'),
    stage('planning-review', 'review', 'stage-reviewer'),
    stage('implementation-review', 'review', 'stage-reviewer'),
    stage('knowledge-extraction', 'aggregator', 'knowledge-curator'),
  ];
}

function sixAgentRoster(): CompatibilityAgent[] {
  return [
    agentDef('requirements-analyst', analystPattern()),
    agentDef('systems-architect', analystPattern()),
    agentDef('task-planner', analystPattern()),
    agentDef('implementation-engineer', engineerPattern()),
    agentDef('stage-reviewer', reviewerPattern()),
    agentDef('knowledge-curator', analystPattern()),
  ];
}

// --- Kind contracts (DEC-005) -----------------------------------------------

test('KIND_PERMISSION_CONTRACTS encode the accepted kind matrix', () => {
  assert.deepEqual(KIND_PERMISSION_CONTRACTS.authoring, {
    file_read: 'allow',
    file_write: 'allow',
    shell: 'allow',
    subagent: 'allow',
    web: 'deny',
  });
  assert.deepEqual(KIND_PERMISSION_CONTRACTS.review, {
    file_read: 'allow',
    search: 'allow',
    shell: 'allow',
    file_write: 'deny',
    subagent: 'deny',
    web: 'deny',
  });
  assert.deepEqual(KIND_PERMISSION_CONTRACTS.tasks, {
    file_read: 'allow',
    search: 'allow',
    file_write: 'allow',
    shell: 'allow',
    subagent: 'allow',
    web: 'deny',
  });
  assert.deepEqual(KIND_PERMISSION_CONTRACTS.aggregator, {
    file_read: 'allow',
    file_write: 'allow',
    shell: 'allow',
    subagent: 'allow',
    web: 'deny',
  });
});

// --- computeEffectivePermissions (API-003) ----------------------------------

test('computeEffectivePermissions: the kind contract is the baseline', () => {
  assert.deepEqual(computeEffectivePermissions({ kind: 'tasks' }), {
    file_read: 'allow',
    search: 'allow',
    file_write: 'allow',
    shell: 'allow',
    subagent: 'allow',
    web: 'deny',
  });
});

test('computeEffectivePermissions: per-key overrides take precedence over the kind contract', () => {
  // A floor turned into a ceiling for this stage (AC-017 / SC-015).
  const effective = computeEffectivePermissions({
    kind: 'authoring',
    permissionOverrides: { shell: 'deny' },
  });
  assert.equal(effective.shell, 'deny');
  assert.equal(effective.file_read, 'allow'); // untouched keys keep contract values
  assert.equal(effective.web, 'deny');

  // A ceiling lifted to a floor for this stage.
  const relaxed = computeEffectivePermissions({
    kind: 'review',
    permissionOverrides: { file_write: 'allow' },
  });
  assert.equal(relaxed.file_write, 'allow');
});

test('computeEffectivePermissions: override values outside allow/deny and unknown keys are ignored', () => {
  // The stage meta-schema already rejects 'ask' overrides and unknown keys;
  // the module ignores them defensively so nothing can weaken a contract.
  assert.deepEqual(
    computeEffectivePermissions({
      kind: 'authoring',
      permissionOverrides: { web: 'ask', file_red: 'allow', shell: 'deny' },
    }),
    {
      file_read: 'allow',
      file_write: 'allow',
      shell: 'deny',
      subagent: 'allow',
      web: 'deny',
    }
  );
});

test('computeEffectivePermissions: an unknown kind constrains nothing beyond its overrides', () => {
  // Unreachable from the registry (meta-schema rejects unknown kinds); the
  // fallback keeps the module total and deterministic.
  assert.deepEqual(
    computeEffectivePermissions({ kind: 'nonsense', permissionOverrides: { web: 'allow' } }),
    { web: 'allow' }
  );
});

// --- checkAgentCompatibility (API-004) --------------------------------------

test('floor violation: a bound agent must declare allow for every floor key', () => {
  const findings = checkAgentCompatibility(
    [stage('requirements', 'authoring', 'analyst')],
    [agentDef('analyst', analystPattern({ file_read: 'ask' }))]
  );
  assert.deepEqual(findings, [
    { stage: 'requirements', agent: 'analyst', key: 'file_read', required: 'allow', actual: 'ask' },
  ]);
});

test('ceiling violation: a bound agent must declare deny for every ceiling key', () => {
  const findings = checkAgentCompatibility(
    [stage('requirements', 'authoring', 'analyst')],
    [agentDef('analyst', analystPattern({ web: 'allow' }))]
  );
  assert.deepEqual(findings, [
    { stage: 'requirements', agent: 'analyst', key: 'web', required: 'deny', actual: 'allow' },
  ]);
});

test('overrides win over the kind contract inside the compatibility check', () => {
  // Lifted ceiling: review normally denies file_write; the override allows a
  // reviewer with write access through (AC-017).
  const lifted = checkAgentCompatibility(
    [
      stage('requirements-review', 'review', 'reviewer', {
        file_write: 'allow',
        subagent: 'allow',
      }),
    ],
    [agentDef('reviewer', reviewerPattern({ file_write: 'allow', subagent: 'allow' }))]
  );
  assert.deepEqual(lifted, []);

  // Tightened floor: an authoring stage that denies file_read even though its
  // kind contract floors it.
  const tightened = checkAgentCompatibility(
    [stage('requirements', 'authoring', 'analyst', { file_read: 'deny' })],
    [agentDef('analyst', analystPattern())]
  );
  assert.deepEqual(tightened, [
    { stage: 'requirements', agent: 'analyst', key: 'file_read', required: 'deny', actual: 'allow' },
  ]);
});

test('unconstrained keys accept ask: authoring/aggregator do not constrain search', () => {
  const findings = checkAgentCompatibility(
    [
      stage('requirements', 'authoring', 'analyst'),
      stage('knowledge-extraction', 'aggregator', 'curator'),
    ],
    [
      agentDef('analyst', analystPattern({ search: 'ask' })),
      agentDef('curator', analystPattern({ search: 'ask' })),
    ]
  );
  assert.deepEqual(findings, []);
});

test('a compatible single binding yields no findings', () => {
  const findings = checkAgentCompatibility(
    [stage('implementation', 'tasks', 'engineer')],
    [agentDef('engineer', engineerPattern())]
  );
  assert.deepEqual(findings, []);
});

test('multi-binding: the union of floors is enforced with a single finding', () => {
  // Both stages floor file_read; the agent's single failure is reported once,
  // naming the deterministically-first stage.
  const findings = checkAgentCompatibility(
    [
      stage('b', 'tasks', 'shared'),
      stage('a', 'tasks', 'shared'),
    ],
    [agentDef('shared', engineerPattern({ file_read: 'ask' }))]
  );
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], {
    stage: 'a',
    agent: 'shared',
    key: 'file_read',
    required: 'allow',
    actual: 'ask',
  });
});

test('multi-binding: a floor contributed by only one binding still binds (union)', () => {
  // search is floored by tasks but unconstrained by authoring; the union keeps
  // the floor alive through the authoring-stage binding.
  const findings = checkAgentCompatibility(
    [
      stage('requirements', 'authoring', 'shared'),
      stage('implementation', 'tasks', 'shared'),
    ],
    [agentDef('shared', analystPattern({ search: 'ask', web: 'deny' }))]
  );
  assert.deepEqual(findings, [
    { stage: 'implementation', agent: 'shared', key: 'search', required: 'allow', actual: 'ask' },
  ]);
});

test('multi-binding: the intersection of ceilings is enforced with a single finding', () => {
  // Both review bindings ceiling web; one finding names the first stage.
  const findings = checkAgentCompatibility(
    [
      stage('requirements-review', 'review', 'reviewer'),
      stage('design-review', 'review', 'reviewer'),
    ],
    [agentDef('reviewer', reviewerPattern({ web: 'allow' }))]
  );
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], {
    stage: 'design-review',
    agent: 'reviewer',
    key: 'web',
    required: 'deny',
    actual: 'allow',
  });
});

test('conflicting bindings report the agent and both conflicting stage ids', () => {
  // implementation (tasks) floors file_write and subagent; implementation-review
  // (review) ceilings them — unsolvable for any declaration (AC-023 / SC-019).
  const findings = checkAgentCompatibility(
    [
      stage('implementation', 'tasks', 'engineer'),
      stage('implementation-review', 'review', 'engineer'),
    ],
    [agentDef('engineer', engineerPattern())]
  );
  assert.deepEqual(findings, [
    {
      stage: 'implementation',
      agent: 'engineer',
      key: 'file_write',
      required: 'allow',
      actual: 'deny',
      conflict_with: 'implementation-review',
    },
    {
      stage: 'implementation',
      agent: 'engineer',
      key: 'subagent',
      required: 'allow',
      actual: 'deny',
      conflict_with: 'implementation-review',
    },
  ]);
});

test('unknown bound agent id produces a binding-resolution finding', () => {
  const findings = checkAgentCompatibility(
    [
      stage('requirements', 'authoring', 'ghost'),
      stage('design', 'authoring', 'systems-architect'),
    ],
    [agentDef('systems-architect', analystPattern())]
  );
  assert.deepEqual(findings, [
    { stage: 'requirements', agent: 'ghost', key: '', required: 'resolvable', actual: 'unresolved' },
  ]);
});

test('empty stages and unused agents produce no findings', () => {
  assert.deepEqual(checkAgentCompatibility([], sixAgentRoster()), []);
  assert.deepEqual(checkAgentCompatibility(nineStageBindings(), []).length, 9); // every binding unresolved
});

test('output is deterministic regardless of input ordering (NFR-005)', () => {
  const forward = [
    stage('implementation', 'tasks', 'engineer'),
    stage('implementation-review', 'review', 'engineer'),
  ];
  const reversed = [...forward].reverse();
  const agents = [agentDef('engineer', engineerPattern())];

  // The two conflicting keys (file_write, subagent) name the same pair of
  // stages; web stays a shared ceiling and the remaining floors are satisfied,
  // so exactly these two findings.
  const expected = [
    {
      stage: 'implementation',
      agent: 'engineer',
      key: 'file_write',
      required: 'allow',
      actual: 'deny',
      conflict_with: 'implementation-review',
    },
    {
      stage: 'implementation',
      agent: 'engineer',
      key: 'subagent',
      required: 'allow',
      actual: 'deny',
      conflict_with: 'implementation-review',
    },
  ];

  assert.deepEqual(checkAgentCompatibility(forward, agents), expected);
  assert.deepEqual(checkAgentCompatibility(reversed, agents), expected);
});

// --- Full matrix: six-agent roster against the nine stage bindings ----------

test('the six-agent roster passes against all nine stage bindings (AC-016 / SC-014)', () => {
  const findings = checkAgentCompatibility(nineStageBindings(), sixAgentRoster());
  assert.deepEqual(findings, []);
});