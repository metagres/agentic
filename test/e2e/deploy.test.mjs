import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deployScript = path.resolve(__dirname, '../../bin/deploy-to-agent.mjs');

function makeTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-deploy-'));
}

test('deploy-to-agent generates runtime and skills without .opencode hardcoding', () => {
  const tmp = makeTmpProject();
  const dest = path.join(tmp, '.agent');

  const res = spawnSync(
    process.execPath,
    [
      deployScript,
      '--dest',
      dest,
      '--project-root',
      tmp,
      '--clean',
      '--skip-smoke',
    ],
    {
      encoding: 'utf8',
    }
  );

  assert.equal(res.status, 0, res.stderr);

  const json = JSON.parse(res.stdout);

  assert.equal(json.ok, true);
  assert.equal(json.cliPath, '.agent/sdlc/scripts/sdlc.mjs');

  assert.ok(
    fs.existsSync(path.join(dest, 'sdlc', 'scripts', 'sdlc.mjs'))
  );

  assert.ok(
    fs.existsSync(path.join(dest, 'sdlc', 'contracts', 'requirements-contract.yaml'))
  );

  assert.ok(
    fs.existsSync(path.join(dest, 'sdlc', 'templates', 'requirements.yaml'))
  );

  assert.ok(
    fs.existsSync(
      path.join(dest, 'skills', 'requirements-authoring', 'SKILL.md')
    )
  );

  const skillContent = fs.readFileSync(
    path.join(dest, 'skills', 'requirements-authoring', 'SKILL.md'),
    'utf8'
  );

  assert.ok(skillContent.includes('.agent/sdlc/scripts/sdlc.mjs'));
  assert.ok(!skillContent.includes('.opencode'));
});
