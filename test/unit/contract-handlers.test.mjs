import test from 'node:test';
import assert from 'node:assert/strict';

import { runChecks } from '../../src/scripts/lib/contract-checks.mjs';

test('dependency_order detects dependency appearing later', () => {
  const contract = {
    checks: [
      {
        id: 'dependency_order',
        type: 'dependency_order',
        severity: 'blocking',
        category: 'structural',
        message: 'Bad dependency order',
        fix: 'Reorder tasks',
        params: {
          tasks_field: 'tasks',
          id_field: 'id',
          depends_field: 'depends_on',
        },
      },
    ],
    semantic_checks: [],
  };

  const artifact = {
    tasks: [
      { id: 'TASK-001', depends_on: ['TASK-002'] },
      { id: 'TASK-002', depends_on: [] },
    ],
  };

  const findings = runChecks(artifact, contract, {});

  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'dependency_order');
});

test('tasks_all_complete detects incomplete task', () => {
  const contract = {
    checks: [
      {
        id: 'tasks_all_complete',
        type: 'tasks_all_complete',
        severity: 'blocking',
        category: 'completeness',
        message: 'Not complete',
        fix: 'Finish tasks',
        params: {
          tasks_field: 'tasks',
          status_field: 'status',
          complete_statuses: ['done', 'skipped'],
        },
      },
    ],
    semantic_checks: [],
  };

  const artifact = {
    tasks: [
      { id: 'TASK-001', status: 'done' },
      { id: 'TASK-002', status: 'in_progress' },
    ],
  };

  const findings = runChecks(artifact, contract, {});

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('TASK-002'));
});

test('execution_note_required requires note for done tasks', () => {
  const contract = {
    checks: [
      {
        id: 'execution_note_required',
        type: 'execution_note_required',
        severity: 'blocking',
        category: 'completeness',
        message: 'Note required',
        fix: 'Add note',
        params: {
          tasks_field: 'tasks',
          status_field: 'status',
          note_field: 'implementation_note',
          require_statuses: ['done', 'blocked', 'skipped'],
        },
      },
    ],
    semantic_checks: [],
  };

  const artifact = {
    tasks: [
      { id: 'TASK-001', status: 'done', implementation_note: '' },
      { id: 'TASK-002', status: 'done', implementation_note: 'Implemented and verified.' },
    ],
  };

  const findings = runChecks(artifact, contract, {});

  assert.equal(findings.length, 1);
  assert.ok(findings[0].finding.includes('TASK-001'));
});
