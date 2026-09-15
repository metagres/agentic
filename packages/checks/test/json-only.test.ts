import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The library must stay JSON-only: no YAML parser, no toolkit imports.
const srcDir = fileURLToPath(new URL('../src', import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('no source file imports a YAML parser', () => {
  for (const file of tsFiles(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(
      !/from\s+'yaml'|require\('yaml'\)/.test(text),
      `${file} must not import the yaml package`
    );
  }
});

test('no source file imports from the toolkit src tree', () => {
  for (const file of tsFiles(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(
      !text.includes('src/scripts'),
      `${file} must not reference the toolkit source tree`
    );
  }
});
