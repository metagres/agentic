import path from 'node:path';
import { readYaml } from '../../src/scripts/lib/yaml-io.mjs';

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function semanticResults(root, contractName) {
  const contractPath = path.join(
    root,
    'src',
    'contracts',
    `${contractName}-contract.yaml`
  );
  const contract = readYaml(contractPath);
  return (contract?.semantic_checks || []).map((check) => ({
    check_id: check.id,
    status: 'pass',
    evidence: 'Verified with automated end-to-end conformance test.',
    evaluated_at: today(),
  }));
}

function discoveryLog() {
  const mk = (id, lens, question, answer) => ({
    id,
    question,
    answer,
    lens,
    resolved: true,
  });
  return [
    mk('DL-001', 'stakeholder', 'Who is the primary stakeholder?', 'Platform operators who onboard devices.'),
    mk('DL-002', 'interface', 'What interface is used?', 'A POST endpoint accepting a JSON registration payload.'),
    mk('DL-003', 'failure', 'What happens on duplicate registration?', 'The system rejects with a conflict response and logs it.'),
    mk('DL-004', 'constraint', 'Are there constraints?', 'Registration must finish within 500 ms and require an API key.'),
    mk('DL-005', 'scope', 'What is in scope?', 'Only creation of new device records, not updates or deletion.'),
  ];
}

function defaultDelta(phase) {
  return [
    {
      phase,
      target_doc: 'docs/current/overview.md',
      change: 'Add',
      reason: 'Add an overview section describing this change for the living docs.',
      date: '2026-07-23',
    },
  ];
}

export function validRequirements({
  title = 'Device registration',
  request = 'Add device registration',
  semantic = [],
  delta,
} = {}) {
  return {
    metadata: {
      id: 'REQ-001',
      title,
      stage: 'requirements',
      status: 'draft',
      version: '0.1.0',
      created: today(),
      updated: today(),
      request_summary: request,
      clarity: 'partial',
      assumptions_reviewed: true,
      delta_reviewed: true,
    },
    problem_statement:
      'Operators cannot register devices, so onboarding requires manual database edits.',
    discovery_log: discoveryLog(),
    assumptions: [
      {
        type: 'verified',
        text: 'The database already stores device records.',
        source: 'src/devices.js',
        risk: 'Schema drift could break registration.',
      },
    ],
    functional_requirements: [
      {
        id: 'FR-001',
        description:
          'The system shall create a device record when a registration payload contains a unique external identifier.',
        ac_ids: ['AC-001'],
      },
    ],
    non_functional_requirements: [
      {
        id: 'NFR-001',
        description:
          'The registration endpoint shall respond within 500 ms for 95 percent of requests.',
        ac_ids: ['AC-002'],
      },
    ],
    acceptance_criteria: [
      {
        id: 'AC-001',
        statement:
          'Given no device exists, When the client submits a registration, Then the system returns 201 and a device identifier.',
        parent_id: 'FR-001',
      },
      {
        id: 'AC-002',
        statement:
          'Given load conditions, When 95 percent of requests are measured, Then response time is below 500 ms.',
        parent_id: 'NFR-001',
      },
    ],
    out_of_scope: ['Device update and deletion are out of scope.'],
    failure_paths: ['Duplicate external identifier is rejected with 409.'],
    risks_and_dependencies: ['External identifier uniqueness depends on client data.'],
    delta: Array.isArray(delta) ? delta : defaultDelta('Requirements'),
    semantic_validation: semantic,
  };
}

export function validDesign({
  title = 'Device registration design',
  reqVersion = '0.1.0',
  semantic = [],
  delta,
} = {}) {
  return {
    metadata: {
      id: 'DES-001',
      title,
      stage: 'design',
      status: 'draft',
      version: '0.1.0',
      created: today(),
      updated: today(),
      based_on_requirements: reqVersion,
      delta_reviewed: true,
    },
    context_summary:
      'The design adds a registration endpoint backed by a device repository.',
    components: [
      {
        id: 'CMP-001',
        name: 'Device Registration API',
        responsibility: 'Accept registration requests and persist device records.',
      },
    ],
    data_models: [{ id: 'DM-001', name: 'Device' }],
    apis: [{ id: 'API-001', path: '/devices', method: 'POST' }],
    flows: [],
    decisions: [
      {
        id: 'DEC-001',
        title: 'Use external identifier',
        context: 'Devices provide an external identifier.',
        decision: 'Use the external identifier as the unique key.',
        status: 'accepted',
      },
    ],
    traceability: [{ requirement_id: 'FR-001', component_ids: ['CMP-001'] }],
    delta: Array.isArray(delta) ? delta : defaultDelta('Design'),
    semantic_validation: semantic,
  };
}

export function validPlan({
  title = 'Device registration plan',
  reqVersion = '0.1.0',
  designVersion = '0.1.0',
  semantic = [],
  delta,
} = {}) {
  return {
    metadata: {
      id: 'PLAN-001',
      title,
      stage: 'planning',
      status: 'draft',
      version: '0.1.0',
      created: today(),
      updated: today(),
      based_on_design: designVersion,
      based_on_requirements: reqVersion,
      implementation_status: 'pending',
      delta_reviewed: true,
    },
    tasks: [
      {
        id: 'TASK-001',
        title: 'Implement device registration',
        description: 'Add endpoint and persistence for device registration.',
        type: 'implementation',
        status: 'pending',
        complexity: 'low',
        covers: ['FR-001', 'NFR-001'],
        acceptance_ids: ['AC-001', 'AC-002'],
        design_refs: ['DEC-001'],
        depends_on: [],
        files: [{ path: 'src/devices.js', operation: 'create' }],
      },
    ],
    milestones: [],
    risks: [],
    delta: Array.isArray(delta) ? delta : defaultDelta('Planning'),
    semantic_validation: semantic,
  };
}
