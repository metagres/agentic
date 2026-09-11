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

function makeTmpProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-rej-'));
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'architecture.md'),
    '# architecture.md\n',
    'utf8'
  );
  return tmp;
}

function run(tmp, args, input) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function semanticFailureFile(tmp, stageId, index, evidence) {
  const checksPath = path.join(root, 'src', 'stages', stageId, 'semantic-checks.yaml');
  const checks = readYaml(checksPath).checks;
  const file = path.join(tmp, `${stageId}-semantic-failure.yaml`);
  fs.writeFileSync(
    file,
    `- check: ${JSON.stringify(checks[index])}\n  evidence: ${JSON.stringify(evidence)}\n`,
    'utf8'
  );
  return file;
}

/** Introduces a blocking mechanical finding by duplicating an AC id on disk. */
function breakArtifact(changeRoot) {
  const artifactPath = path.join(changeRoot, 'requirements.yaml');
  const artifact = readYaml(artifactPath);
  const criteria = artifact.functional_requirements[0].acceptance_criteria;
  criteria.push({ ...criteria[0] });
  artifact.metadata.status = 'ready-for-review';
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');
}

function fixArtifact(changeRoot) {
  const artifactPath = path.join(changeRoot, 'requirements.yaml');
  const artifact = readYaml(artifactPath);
  artifact.functional_requirements[0].acceptance_criteria.pop();
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');
}

test('mechanical rejection loop: CLI-computed failures, recovery exposure, re-finalize, re-review accepted', () => {
  const tmp = makeTmpProject();
  assert.equal(run(tmp, ['init', '--change', 'add-login']).state, 'ok');
  let out = run(tmp, ['requirements', '--change', 'add-login']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  out = run(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request: 'Add login' }))
  );
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  // Break the artifact, then reject: mechanical failures are CLI-computed and
  // the rejection needs no reviewer input.
  breakArtifact(changeRoot);
  out = run(tmp, ['requirements-review', '--change', changeDir, '--reject']);
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.data.status, 'rejected');
  assert.equal(out.data.artifact_status, 'rejected');
  assert.ok(out.data.failures.length > 0);
  assert.equal(out.data.failures[0].check, 'unique-ids');
  assert.match(out.data.failures[0].evidence, /Fix: /);

  const req = readYaml(path.join(changeRoot, 'requirements.yaml'));
  assert.equal(req.metadata.status, 'rejected');
  const v1 = req.metadata.version;

  let rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);
  assert.equal(rev.rounds[0].status, 'rejected');
  assert.equal(rev.rounds[0].mechanical_checks_passed, false);
  assert.equal('semantic' in rev.rounds[0], false);
  assert.equal(rev.metadata.latest_status, 'rejected');

  // The authoring recovery envelope exposes the recorded failures.
  out = run(tmp, ['requirements', '--change', changeDir]);
  assert.equal(out.step, 'recovery');
  assert.equal(out.state, 'blocked');
  assert.deepEqual(out.data.review_failures, rev.rounds[0].failures);

  // Fix the artifact and re-finalize: the patch bump is automatic.
  fixArtifact(changeRoot);
  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const recovered = readYaml(path.join(changeRoot, 'requirements.yaml'));
  assert.equal(recovered.metadata.status, 'ready-for-review');
  assert.notEqual(recovered.metadata.version, v1);

  // Re-review accepts with a bare --accept: failures [] and both flags true.
  out = run(tmp, ['requirements-review', '--change', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));
  assert.equal(out.data.status, 'accepted');
  assert.deepEqual(out.data.failures, []);

  const accepted = readYaml(path.join(changeRoot, 'requirements.yaml'));
  assert.equal(accepted.metadata.status, 'accepted');

  const revAfter = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(revAfter.rounds.length, 2);
  assert.deepEqual(revAfter.rounds.map((r) => r.status), ['rejected', 'accepted']);
  assert.equal(revAfter.rounds[1].mechanical_checks_passed, true);
  assert.equal(revAfter.rounds[1].semantic_checks_passed, true);
  assert.deepEqual(revAfter.rounds[1].failures, []);
});

test('semantic rejection loop: --reject --failures records the failed checks and the loop closes', () => {
  const tmp = makeTmpProject();
  assert.equal(run(tmp, ['init', '--change', 'add-logout']).state, 'ok');
  let out = run(tmp, ['requirements', '--change', 'add-logout']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  out = run(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request: 'Add logout' }))
  );
  assert.notEqual(out.state, 'blocked');

  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  // Bare --reject with passing mechanicals is refused: rejections are
  // evidence-backed.
  out = run(tmp, ['requirements-review', '--change', changeDir, '--reject']);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'USAGE');
  assert.equal(fs.existsSync(path.join(changeRoot, 'requirements-review.yaml')), false);

  // --reject --failures records the failed semantic checks.
  const failures = semanticFailureFile(tmp, 'requirements', 0, 'The problem statement proposes a solution.');
  out = run(tmp, ['requirements-review', '--change', changeDir, '--reject', '--failures', failures]);
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.data.status, 'rejected');
  assert.equal(out.data.artifact_status, 'rejected');

  const rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds[0].status, 'rejected');
  assert.equal(rev.rounds[0].mechanical_checks_passed, true);
  assert.equal(rev.rounds[0].semantic_checks_passed, false);
  assert.equal(rev.rounds[0].failures[0].check, readYaml(
    path.join(root, 'src', 'stages', 'requirements', 'semantic-checks.yaml')
  ).checks[0]);

  // The recovery envelope exposes the semantic failures for repair.
  out = run(tmp, ['requirements', '--change', changeDir]);
  assert.equal(out.step, 'recovery');
  assert.deepEqual(out.data.review_failures, rev.rounds[0].failures);

  // Re-finalize (patch bump) and re-review accepted.
  out = run(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ title: 'Add logout recovered', request: 'Add logout' }))
  );
  assert.notEqual(out.state, 'blocked');
  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  out = run(tmp, ['requirements-review', '--change', changeDir, '--accept']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const req = readYaml(path.join(changeRoot, 'requirements.yaml'));
  assert.equal(req.metadata.status, 'accepted');

  const revAfter = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(revAfter.rounds.length, 2);
  assert.deepEqual(revAfter.rounds.map((r) => r.status), ['rejected', 'accepted']);
});

test('--failures - reads the failures YAML from stdin: valid records, invalid refuses with nothing written', () => {
  const tmp = makeTmpProject();
  assert.equal(run(tmp, ['init', '--change', 'add-stdin-reject']).state, 'ok');
  let out = run(tmp, ['requirements', '--change', 'add-stdin-reject']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  out = run(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(validRequirements({ request: 'Add stdin reject' }))
  );
  assert.notEqual(out.state, 'blocked');
  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));

  const check = readYaml(
    path.join(root, 'src', 'stages', 'requirements', 'semantic-checks.yaml')
  ).checks[0] as string;

  // Empty stdin: refused as a malformed failures document, nothing written.
  out = run(tmp, ['requirements-review', '--change', changeDir, '--reject', '--failures', '-'], '');
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'FAILURE_ENTRY_INVALID');
  assert.equal(fs.existsSync(path.join(changeRoot, 'requirements-review.yaml')), false);

  // Duplicate stdin entries: refused with the merge-rule message, nothing written.
  const dupYaml = [
    `- check: ${JSON.stringify(check)}`,
    '  evidence: "first finding"',
    `- check: ${JSON.stringify(check)}`,
    '  evidence: "second finding"',
    '',
  ].join('\n');
  out = run(tmp, ['requirements-review', '--change', changeDir, '--reject', '--failures', '-'], dupYaml);
  assert.equal(out.state, 'blocked');
  assert.equal(out.errors[0].code, 'SEMANTIC_FAILURE_INVALID');
  assert.match(String(out.errors[0].message), /One entry per failed check: merge all findings of that check into the single entry's evidence/);
  assert.equal(fs.existsSync(path.join(changeRoot, 'requirements-review.yaml')), false);

  // Valid stdin YAML: the round is recorded rejected with the entries.
  const validYaml = [
    `- check: ${JSON.stringify(check)}`,
    '  evidence: "The problem statement proposes a solution."',
    '',
  ].join('\n');
  out = run(tmp, ['requirements-review', '--change', changeDir, '--reject', '--failures', '-'], validYaml);
  assert.equal(out.state, 'blocked', JSON.stringify(out));
  assert.equal(out.data.status, 'rejected');
  assert.equal(out.data.artifact_status, 'rejected');

  const rev = readYaml(path.join(changeRoot, 'requirements-review.yaml'));
  assert.equal(rev.rounds.length, 1);
  assert.equal(rev.rounds[0].status, 'rejected');
  assert.equal(rev.rounds[0].semantic_checks_passed, false);
  assert.equal(rev.rounds[0].failures[0].check, check);
});
