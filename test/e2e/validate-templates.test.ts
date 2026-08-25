import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

// The bin resolves the repository root from its own location, so each test
// runs against a hermetic copy of bin/ + src/ in a temp dir. A symlink to the
// real node_modules keeps ESM resolution working for the yaml dependency.
function makeSandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-validate-templates-'));
  fs.cpSync(path.join(root, 'bin'), path.join(tmp, 'bin'), { recursive: true });
  fs.cpSync(path.join(root, 'src'), path.join(tmp, 'src'), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'));
  return tmp;
}

function runBin(sandbox: string) {
  return spawnSync(process.execPath, [path.join(sandbox, 'bin', 'validate-templates.ts')], {
    encoding: 'utf8',
    cwd: sandbox,
  });
}

function writeSkill(sandbox: string, folderName: string, skillMd: string) {
  const folder = path.join(sandbox, 'src', 'skills', folderName);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'SKILL.md'), skillMd, 'utf8');
}

test('validate-templates fails on a frontmatter name mismatch', () => {
  const sandbox = makeSandbox();
  try {
    writeSkill(
      sandbox,
      'mismatch-skill',
      '---\nname: other-name\ndescription: A test skill.\n---\n\n# Mismatch\n'
    );

    const res = runBin(sandbox);
    assert.notEqual(res.status, 0, res.stdout);

    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    const failing = json.skills.find((s) => s.file === 'skills/mismatch-skill/SKILL.md');
    assert.ok(failing, JSON.stringify(json.skills));
    assert.equal(failing.ok, false);
    assert.match(failing.error, /mismatch-skill/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('validate-templates fails on an empty description', () => {
  const sandbox = makeSandbox();
  try {
    writeSkill(
      sandbox,
      'empty-desc-skill',
      '---\nname: empty-desc-skill\ndescription: ""\n---\n\n# Empty\n'
    );

    const res = runBin(sandbox);
    assert.notEqual(res.status, 0, res.stdout);

    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    const failing = json.skills.find((s) => s.file === 'skills/empty-desc-skill/SKILL.md');
    assert.ok(failing, JSON.stringify(json.skills));
    assert.equal(failing.ok, false);
    assert.match(failing.error, /description/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('validate-templates passes on the checked-in skill folders', () => {
  const sandbox = makeSandbox();
  try {
    const res = runBin(sandbox);
    assert.equal(res.status, 0, res.stdout);

    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, true);
    assert.ok(
      json.skills.some((s) => s.file === 'skills/knowledge-init/SKILL.md' && s.ok),
      JSON.stringify(json.skills)
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});