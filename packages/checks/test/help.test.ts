import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatHelp } from '../src/help.ts';
import { checks } from '../src/index.ts';
import type { CheckManifest } from '../src/types.ts';

test('help text lists name, description, and each parameter with required marker', () => {
  for (const manifest of Object.values(checks).map((e) => e.manifest)) {
    const text = formatHelp(manifest);
    assert.ok(text.startsWith(`${manifest.name} — ${manifest.description}`));

    for (const param of manifest.params) {
      const escaped = param.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const line = text
        .split('\n')
        .find((l) => new RegExp(`^\\s*${escaped}\\s`).test(l));
      assert.ok(line, `${manifest.name}.${param.name} must have a help line`);
      assert.ok(line.includes(param.type), `help line for ${param.name} must include its type`);
      assert.ok(
        line.includes(param.required ? 'required' : 'optional'),
        `help line for ${param.name} must state requiredness`
      );
      if (param.default !== undefined) {
        assert.ok(
          line.includes(`default: ${JSON.stringify(param.default)}`),
          `help line for ${param.name} must render its default`
        );
      }
    }
  }
});

test('help text renders aligned columns for unique-ids', () => {
  const text = checks['unique-ids'].help();
  const lines = text.split('\n');
  assert.ok(lines[0].includes('unique-ids —'));
  assert.ok(lines.includes('Parameters:'));
  const arraysLine = lines.find((l) => l.includes(' arrays'))!;
  assert.ok(arraysLine.includes('required'));
  const idLine = lines.find((l) => l.includes(' id_field'))!;
  assert.ok(idLine.includes('optional'));
  assert.ok(idLine.includes('default: "id"'));
});

test('formatHelp handles manifests without parameters', () => {
  const manifest: CheckManifest = {
    name: 'empty',
    description: 'A check without parameters.',
    params: [],
  };
  assert.match(formatHelp(manifest), /This check takes no parameters\./);
});
