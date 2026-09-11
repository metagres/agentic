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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-disc-'));
  fs.mkdirSync(path.join(tmp, 'docs', 'current'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'current', 'overview.md'),
    '# overview.md\n',
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

// The requirements tour routes through the discovery confirmation (interview
// gate): a fresh artifact enters discovery directly (engagement contract — no
// init step), an unconfirmed discovery flag pins the interview open, and
// one-call finalize evaluates the mechanical and semantic gates together.
test('an in-flight artifact routes through the confirmed discovery gate', () => {
  const tmp = makeTmpProject();

  assert.equal(run(tmp, ['init', '--change', 'add-device-registration']).state, 'ok');
  let out = run(tmp, ['requirements', '--change', 'add-device-registration']);
  const changeRoot = out.data.change_root;
  const changeDir = path.basename(changeRoot);

  // Fresh artifact: discovery unconfirmed -> discovery.
  assert.equal(out.step, 'discovery', JSON.stringify(out));

  // Content present and mechanically clean but discovery unconfirmed: the
  // machine stays at discovery until the gate is explicitly confirmed.
  const artifact = validRequirements({}) as Record<string, unknown>;
  const meta = artifact.metadata as Record<string, unknown>;
  delete meta.discovery_reviewed;
  (artifact.discovery_log as Record<string, unknown>[]).pop(); // remove the data-lens answer

  out = run(
    tmp,
    ['requirements', '--change', changeDir, '--update-artifact'],
    JSON.stringify(artifact)
  );
  assert.equal(out.step, 'discovery', JSON.stringify(out));

  out = run(tmp, ['requirements', '--change', changeDir, '--complete-step', '--step', 'discovery']);
  assert.equal(out.step, 'ready', JSON.stringify(out));

  // One-call finalize evaluates the mechanical and semantic gates together.
  out = run(tmp, ['requirements', '--change', changeDir, '--finalize', '--confirm-semantic']);
  assert.equal(out.state, 'complete', JSON.stringify(out));
});
