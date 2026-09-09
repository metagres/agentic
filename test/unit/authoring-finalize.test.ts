import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../../src/scripts/lib/yaml-io.ts';
import { validRequirements } from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');
const lint = path.join(root, 'bin', 'lint-artifact.ts');

function tmpProject(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'architecture.md'),
    '# architecture.md\n',
    'utf8'
  );
  return tmp;
}

function runCli(tmp: string, args: string[], input?: string) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function runLint(artifactPath: string) {
  const res = spawnSync(
    process.execPath,
    [lint, '--target', 'requirements', '--artifact', artifactPath, '--no-fail'],
    { encoding: 'utf8', cwd: root }
  );
  assert.ok(res.stdout, `no lint stdout\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupChange(prefix: string, request = 'Add device registration') {
  const tmp = tmpProject(prefix);
  let out = runCli(tmp, ['requirements', '--request', request]);
  const changeRoot = String(out.data.change_root);
  const changeDir = path.basename(changeRoot);
  out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request }))
  );
  assert.notEqual(out.state, 'blocked', JSON.stringify(out));
  return { tmp, changeRoot, changeDir };
}

/** Introduces a mechanical finding (duplicate AC id) on disk. */
function breakArtifact(changeRoot: string): void {
  const artifactPath = path.join(changeRoot, 'requirements.yaml');
  const artifact = readYaml(artifactPath) as Record<string, unknown> & {
    functional_requirements: { acceptance_criteria: Record<string, unknown>[] }[];
    metadata: { status: string };
  };
  const criteria = artifact.functional_requirements[0].acceptance_criteria;
  criteria.push({ ...criteria[0] });
  artifact.metadata.status = 'draft';
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');
}

// ---------------------------------------------------------------------------
// Finalize-block envelope (W3): every finding listed, never empty, no dangling
// bullet, lint pointer present.
// ---------------------------------------------------------------------------

test('finalize on a finding-bearing artifact lists every finding with the lint pointer', () => {
  const { tmp, changeRoot, changeDir } = setupChange('agentic-final-');
  breakArtifact(changeRoot);

  const out = runCli(tmp, [
    'requirements',
    '--change',
    changeDir,
    '--finalize',
    '--confirm-semantic',
  ]);

  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.step, 'recovery');

  // The instructions carry the finding text, not an empty or dangling list.
  assert.match(out.instructions, /Cannot finalize\. Fix the following validation failures:/);
  assert.match(out.instructions, /Duplicate ID 'AC-001'/);
  assert.ok((out.data.errors as unknown[]).length > 0, 'data.errors non-empty');
  for (const err of out.data.errors as { finding: string }[]) {
    assert.ok(out.instructions.includes(err.finding), `instructions carry: ${err.finding}`);
  }
  // No dangling ` - ` bullet: every list line is `- [check] finding — fix`.
  assert.doesNotMatch(out.instructions, /\n\s*-\s*$/);
  assert.match(out.instructions, /- \[unique-ids\] /);
  // The diagnostic pointer names the lint surface.
  assert.match(
    out.instructions,
    /Run node bin\/lint-artifact\.ts --target requirements --artifact .* for details\./
  );
});

// ---------------------------------------------------------------------------
// Hidden-gate diagnosis loop: problems are visible at mutation time.
// ---------------------------------------------------------------------------

test('post---update-artifact envelope carries data.findings and mechanical_valid false', () => {
  const { tmp, changeRoot, changeDir } = setupChange('agentic-final-');
  breakArtifact(changeRoot);

  // Re-submit the (now broken) artifact through --update-artifact.
  const artifact = readYaml(path.join(changeRoot, 'requirements.yaml')) as Record<string, unknown>;
  const out = runCli(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );

  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.step, 'recovery');
  const findings = out.data.findings as { check: string; finding: string }[];
  assert.ok(Array.isArray(findings) && findings.length > 0, 'data.findings non-empty');
  assert.ok(findings.some((f) => f.check === 'unique-ids'), JSON.stringify(findings));
  assert.equal(out.data.mechanical_valid, false);
});

// ---------------------------------------------------------------------------
// Threshold consistency: the envelope, and lint-artifact agree on the same
// findings array for the same artifact (one definition of "blocking").
// ---------------------------------------------------------------------------

test('any finding means mechanical_valid false in the envelope and ok=false in lint-artifact with identical findings', () => {
  const { tmp, changeRoot, changeDir } = setupChange('agentic-final-');
  breakArtifact(changeRoot);

  const out = runCli(tmp, ['requirements', '--change', changeDir]);
  assert.equal(out.data.mechanical_valid, false);
  const envelopeFindings = out.data.findings as { check: string; finding: string }[];
  assert.ok(envelopeFindings.length > 0);

  const lint = runLint(path.join(changeRoot, 'requirements.yaml'));
  assert.equal(lint.ok, false);
  assert.equal('blocking_count' in lint, false, 'no misleading blocking_count key');
  const lintFindings = lint.findings as { check: string; finding: string }[];
  assert.deepEqual(
    lintFindings.map((f) => ({ check: f.check, finding: f.finding })),
    envelopeFindings.map((f) => ({ check: f.check, finding: f.finding }))
  );
  assert.equal(JSON.stringify(lint).includes('"severity"'), false);
});

// ---------------------------------------------------------------------------
// Recovery-text drift: the recovery steps describe validation failures, never
// a review-only rejection.
// ---------------------------------------------------------------------------

test('no stage steps.yaml says the artifact was rejected by review', () => {
  const stagesDir = path.join(root, 'src', 'stages');
  const offenders: string[] = [];
  for (const entry of fs.readdirSync(stagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const stepsPath = path.join(stagesDir, entry.name, 'steps.yaml');
    if (!fs.existsSync(stepsPath)) continue;
    const text = fs.readFileSync(stepsPath, 'utf8');
    if (/rejected by review/i.test(text)) offenders.push(entry.name);
  }
  assert.deepEqual(offenders, []);
});
