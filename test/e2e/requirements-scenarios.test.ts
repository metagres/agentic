import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validRequirements } from '../helpers/artifacts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const cli = path.join(root, 'src', 'scripts', 'sdlc.ts');

function makeTmpProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-scen-'));
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'index.md'),
    '# Current Docs Index\n| File | Purpose | When to Read | Notes |\n|---|---|---|---|\n| docs/current/overview.md | System overview | Start here | Fixture |\n',
    'utf8'
  );
  return tmp;
}

function run(tmp: string, args: string[], input?: string) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    input,
    timeout: 30000,
  });
  assert.ok(res.stdout, `no stdout: ${args.join(' ')}\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

// The collapsed six-step tour (needs_input, init, authoring, ready, complete,
// recovery) no longer routes through granular discovery/scenarios states: the
// only gate between authoring and review is finalize. This test pins that an
// in-flight artifact without any legacy confirmation flags routes through
// authoring/ready and finalizes in one call.
test('an in-flight artifact without confirmation flags routes through authoring/ready and finalizes', () => {
  const tmp = makeTmpProject();

  let out = run(tmp, ['requirements', '--request', 'Add device registration']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  // Fresh artifact: created but empty -> authoring.
  assert.equal(out.step, 'authoring', JSON.stringify(out));

  // Pre-change artifact: no confirmation flags and a discovery_log that
  // predates the data lens (schema-valid under NFR-002).
  const artifact = validRequirements({}) as Record<string, unknown>;
  const meta = artifact.metadata as Record<string, unknown>;
  delete meta.discovery_reviewed;
  delete meta.scenarios_reviewed;
  (artifact.discovery_log as Record<string, unknown>[]).pop(); // remove the data-lens answer

  out = run(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  // Content present and mechanically clean: the machine routes to ready even
  // though the legacy discovery/scenarios confirmation flags are unset — they
  // no longer participate in routing.
  assert.equal(out.step, 'ready', JSON.stringify(out));

  // One-call finalize evaluates the mechanical and semantic gates together.
  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));
});
