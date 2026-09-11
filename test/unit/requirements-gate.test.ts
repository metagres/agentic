import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

// The stable one-line gate rule (W4): identical across every clarity anchor.
const GATE_RULE =
  'passed = all required lenses resolved AND clarity set AND resolved_questions >= minimum';

function runCli(tmp: string, args: string[], input?: string) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

interface Gate {
  rule: string;
  passed: boolean;
  clarity: string;
  clarity_valid: boolean;
  required_lenses: string[];
  missing_lenses: string[];
  resolved_questions: number;
  minimum_questions: number;
  confirmed: boolean;
}

function gateOf(out: Record<string, unknown>): Gate {
  return (out.data as { discovery_gate: Gate }).discovery_gate;
}

test('discovery_gate exposes the stable rule and the policy thresholds per clarity anchor', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-gate-'));
  assert.equal(runCli(tmp, ['init', '--change', 'add-device-registration']).state, 'ok');
  let out = runCli(tmp, ['requirements', '--change', 'add-device-registration']);
  const changeRoot = String(out.data.change_root);
  const changeDir = path.basename(changeRoot);

  // The fresh artifact carries the gate data with the stable rule string.
  const initial = gateOf(out);
  assert.equal(initial.rule, GATE_RULE);

  // One resolved question per lens; each clarity anchor then reports its own
  // required_lenses/minimum_questions and the rule stays byte-identical.
  const lenses = ['stakeholder', 'interface', 'data', 'failure', 'constraint', 'scope'];
  for (const lens of lenses) {
    runCli(tmp, [
      'requirements',
      '--change',
      changeDir,
      '--record-answer',
      '--lens',
      lens,
      '--question',
      `Q-${lens}?`,
      '--answer',
      `Answer for ${lens}.`,
    ]);
  }

  const expectations: Record<string, { required: number; minimum: number }> = {
    clear: { required: 2, minimum: 3 },
    partial: { required: 5, minimum: 5 },
    vague: { required: 8, minimum: 8 },
  };

  const rules: string[] = [];
  for (const [clarity, expected] of Object.entries(expectations)) {
    out = runCli(tmp, ['requirements', '--change', changeDir, '--set-clarity', clarity]);
    const gate = gateOf(out);
    rules.push(gate.rule);

    assert.equal(gate.rule, GATE_RULE, `rule stable for clarity ${clarity}`);
    assert.equal(gate.clarity, clarity);
    assert.equal(gate.clarity_valid, true);
    assert.equal(gate.resolved_questions, lenses.length);
    assert.equal(gate.required_lenses.length, expected.required, clarity);
    assert.equal(gate.minimum_questions, expected.minimum, clarity);
    // The anchors shrink monotonically as documented: vague ⊃ partial ⊃ clear.
    if (clarity !== 'vague') {
      assert.ok(
        gate.required_lenses.length < expectations.vague.required &&
          gate.minimum_questions < expectations.vague.minimum,
        `${clarity} thresholds shrink against vague`
      );
    }
  }

  assert.deepEqual(rules, [GATE_RULE, GATE_RULE, GATE_RULE]);
  assert.equal(fs.existsSync(path.join(changeRoot, 'requirements.yaml')), true);
});
