import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanDeadReferences } from '../../src/scripts/lib/docs-gen/scans.ts';
import { runCrosschecks } from '../../src/scripts/lib/docs-gen/crosscheck.ts';
import { generateAll } from '../../src/scripts/lib/docs-gen/run.ts';
import type { DocsGenManifest, FileProvider, ProviderContext } from '../../src/scripts/lib/docs-gen/types.ts';
import {
  parseSegments,
  renderSegments,
  replaceRegion,
  readRegion,
  requireRegions,
  regionIds,
  DocsGenError,
  regionBeginMarker,
  regionEndMarker,
} from '../../src/scripts/lib/docs-gen/splice.ts';
import {
  splitRow,
  renderTable,
  mergeTableRows,
  parseTableAt,
  tableRowsUnderHeading,
} from '../../src/scripts/lib/docs-gen/table.ts';

const DOC = [
  '# Title',
  '',
  '<!-- docs-gen:begin id="one" -->',
  'old one',
  '<!-- docs-gen:end id="one" -->',
  '',
  'middle prose',
  '',
  '<!-- docs-gen:begin id="two" -->',
  'old two',
  '<!-- docs-gen:end id="two" -->',
  '',
  'tail',
].join('\n');

test('parse/render round-trips byte-identically', () => {
  assert.equal(renderSegments(parseSegments(DOC), new Map()), DOC);
});

test('regions replace content while prose is preserved verbatim', () => {
  const next = renderSegments(parseSegments(DOC), new Map([['one', ['new one']]]));
  assert.ok(next.includes('new one'));
  assert.ok(!next.includes('old one'));
  assert.ok(next.includes('old two'));
  assert.ok(next.includes('middle prose'));
  assert.ok(next.includes(regionBeginMarker('one')));
  assert.ok(next.includes(regionEndMarker('one')));
});

test('repeated generation is idempotent', () => {
  const once = renderSegments(parseSegments(DOC), new Map([['one', ['stable']], ['two', ['stable']]]));
  const twice = renderSegments(parseSegments(once), new Map([['one', ['stable']], ['two', ['stable']]]));
  assert.equal(once, twice);
});

test('replacements for undeclared regions are rejected', () => {
  assert.throws(() => renderSegments(parseSegments(DOC), new Map([['nope', ['x']]])), /does not declare/);
});

test('malformed markers abort with named conditions', () => {
  assert.throws(() => parseSegments('<!-- docs-gen:end id="x" -->'), /no begin marker/);
  assert.throws(() => parseSegments('<!-- docs-gen:begin id="x" -->\nbody'), /never closed/);
  assert.throws(
    () => parseSegments('<!-- docs-gen:begin id="x" -->\n<!-- docs-gen:end id="y" -->'),
    /mismatched end marker/
  );
  assert.throws(
    () =>
      parseSegments(
        '<!-- docs-gen:begin id="x" -->\n<!-- docs-gen:begin id="y" -->'
      ),
    /not closed before a new begin marker/
  );
});

test('duplicate region ids are detectable and rejected by requireRegions', () => {
  const dup = [
    '<!-- docs-gen:begin id="x" -->',
    '<!-- docs-gen:end id="x" -->',
    '<!-- docs-gen:begin id="x" -->',
    '<!-- docs-gen:end id="x" -->',
  ].join('\n');
  assert.deepEqual(regionIds(DOC), ['one', 'two']);
  assert.throws(() => requireRegions(dup, ['x']), /2 times/);
  assert.throws(() => requireRegions(DOC, ['missing']), /does not declare required region/);
  requireRegions(DOC, ['one', 'two']);
});

test('replaceRegion and readRegion round-trip one region', () => {
  const next = replaceRegion(DOC, 'two', ['fresh', 'lines']);
  assert.deepEqual(readRegion(next, 'two'), ['fresh', 'lines']);
  assert.deepEqual(readRegion(next, 'one'), ['old one']);
});

test('readRegion returns preserved lines', () => {
  assert.deepEqual(readRegion(DOC, 'one'), ['old one']);
  assert.equal(readRegion(DOC, 'absent'), null);
});

test('splitRow honors escaped pipes', () => {
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
});

test('parseTableAt consumes header, separator, and rows', () => {
  const lines = '| Name | Version |'.split('\n').concat([
    '| --- | --- |',
    '| ajv | ^8 |',
    '',
    'after',
  ]);
  const parsed = parseTableAt(lines, 0);
  assert.ok(parsed);
  assert.deepEqual(parsed?.header, ['Name', 'Version']);
  assert.deepEqual(parsed?.rows, [['ajv', '^8']]);
});

test('renderTable is deterministic and escapes cells', () => {
  const once = renderTable(['Name', 'Notes'], [['ajv', 'a|b'], ['yaml', 'line1\nline2']]);
  const twice = renderTable(['Name', 'Notes'], [['ajv', 'a|b'], ['yaml', 'line1\nline2']]);
  assert.deepEqual(once, twice);
  assert.equal(once[0], '| Name | Notes |');
  assert.equal(once[1], '| --- | --- |');
  assert.ok(once.some((line) => line.includes('a\\|b')));
  assert.ok(once.some((line) => line.includes('line1 line2')));
});

test('mergeTableRows preserves judgment columns and agent-added rows', () => {
  const existing = [
    ['ajv', '^8.20.0', 'JSON Schema validation', 'src/scripts/lib/schema.ts'],
    ['legacy-only', '^1.0.0', 'agent-added row', 'somewhere'],
  ];
  const generated = [['ajv', '^8.21.0', '', 'src/scripts/lib/schema.ts, bin/x.ts']];
  const merged = mergeTableRows(existing, generated, { keyColumn: 0, preserveColumns: [2], sortBy: 0 });
  assert.deepEqual(merged, [
    ['ajv', '^8.21.0', 'JSON Schema validation', 'src/scripts/lib/schema.ts, bin/x.ts'],
    ['legacy-only', '^1.0.0', 'agent-added row', 'somewhere'],
  ]);
});

test('tableRowsUnderHeading finds the table below a heading', () => {
  const content = [
    '## Key Dependencies',
    '',
    '| Name | Version |',
    '| ---- | ------- |',
    '| yaml | ^2.5.1 |',
    '',
    '## Next',
  ].join('\n');
  assert.deepEqual(tableRowsUnderHeading(content, 'Key Dependencies'), [['yaml', '^2.5.1']]);
  assert.deepEqual(tableRowsUnderHeading(content, 'Missing'), []);
});

test('DocsGenError prefixes its message', () => {
  const err = new DocsGenError('boom');
  assert.equal(err.name, 'DocsGenError');
  assert.equal(err.message, 'docs-gen: boom');
});

// ---------------------------------------------------------------------------
// Characterization oracle (DEC-007 reuse-with-adaptation): pins the observable
// behavior of the primitives the crosscheck gate reuses — scanDeadReferences,
// the table parsers, and the seven cross-checks now enforced by the
// non-rendering gate module (runCrosschecks). Every test runs against a
// fixture tree, never the live repo.
// ---------------------------------------------------------------------------

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

/** Fixture tree on which all seven cross-checks pass and no stale refs exist. */
function greenCrossCheckTree(): Record<string, string> {
  return {
    'package.json': JSON.stringify({ scripts: { sdlc: 'node src/scripts/sdlc.ts' } }),
    'bin/tool.ts': "export const tool = 'bin';\n",
    'src/mod.ts': "import schema from 'ajv';\nexport const use = (): unknown => schema;\n",
    'src/stages/implementation/stage.yaml': 'id: implementation\n',
    'docs/current/glossary.md': [
      '# glossary.md',
      '',
      '## Entity: Plan Task (plan.yaml)',
      '',
      '| Field | Type | Nullable | Source |',
      '| --- | --- | --- | --- |',
      '| id | string | no | plan.yaml |',
    ].join('\n'),
    'docs/current/architecture.md': [
      '# architecture.md',
      '',
      '## Tech Stack',
      '',
      '| Layer | Technologies | Evidence |',
      '| --- | --- | --- |',
      '| Config | YAML, Node.js, TypeScript | package.json |',
      '| Build | tsup | tsup.config.ts |',
      '| Validation | ajv | src/mod.ts |',
      '',
      '## Folder Responsibilities',
      '',
      '| Folder | Responsibility | Evidence |',
      '| --- | --- | --- |',
      '| src/mod/ | Fixture module | src/mod.ts |',
    ].join('\n'),
    'docs/current/capabilities.md': [
      '# capabilities.md',
      '',
      '## Capabilities',
      '',
      '| ID | Capability | Related Entities | Related Endpoints |',
      '| --- | --- | --- | --- |',
      '| G-01 | Fixture capability | Plan Task (plan.yaml) | sdlc implementation |',
    ].join('\n'),
    'docs/current/dependencies.md': [
      '# dependencies.md',
      '',
      '## Key Dependencies',
      '',
      '| Name | Version | Role | Evidence |',
      '| --- | --- | --- | --- |',
      '| ajv | ^8 | schema validation | src/mod.ts, src/mod/ |',
    ].join('\n'),
    'docs/current/known-issues.md': [
      '# known-issues.md',
      '',
      '## Markers',
      '',
      '| Location | Marker | Context | Evidence |',
      '| --- | --- | --- | --- |',
      '| src/mod/flag.ts | TODO | fixture marker | src/mod/flag.ts |',
    ].join('\n'),
  };
}

function fixtureContext(root: string): ProviderContext {
  return {
    root,
    rendered: new Map(),
    readRendered: () => null,
    readExisting: (relPath: string) => {
      const abs = path.join(root, relPath);
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    },
  };
}

test('characterization: scanDeadReferences reports {file, section, context, reference} with section attribution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-staleref-'));
  writeTree(root, {
    'src/exists.ts': 'export const ok = true;\n',
    'src/policies/errors.yaml': [
      '# see docs/gone.md',
      'version: 1',
      'errors:',
      '  CODE_A:',
      '    message: x',
      '    fix: See src/exists.ts for details.',
      '  CODE_B:',
      '    message: y',
      '    fix: See src/gone.ts.',
    ].join('\n'),
  });
  assert.deepEqual(scanDeadReferences(root), [
    {
      file: 'src/policies/errors.yaml:1',
      section: '',
      context: '# see docs/gone.md',
      reference: 'docs/gone.md',
    },
    {
      file: 'src/policies/errors.yaml:9',
      section: 'CODE_B',
      context: 'fix: See src/gone.ts.',
      reference: 'src/gone.ts',
    },
  ]);
});

test('characterization: scanDeadReferences returns zero hits when every referenced path exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-staleref-ok-'));
  writeTree(root, {
    'src/exists.ts': 'export const ok = true;\n',
    'src/policies/errors.yaml': ['version: 1', 'errors:', '  CODE_A:', '    fix: See src/exists.ts.'].join('\n'),
  });
  assert.deepEqual(scanDeadReferences(root), []);
});

test('characterization: tableRowsUnderHeading matches headings exactly, not by prefix', () => {
  const content = ['## Markers Extra', '', '| a | b |', '| --- | --- |', '| x | y |'].join('\n');
  assert.deepEqual(tableRowsUnderHeading(content, 'Markers'), []);
});

test('characterization: all seven cross-checks pass on a green fixture tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-crosscheck-ok-'));
  writeTree(root, greenCrossCheckTree());
  assert.doesNotThrow(() => runCrosschecks(fixtureContext(root)));
});

test('characterization: cross-check violations throw one error naming each failing check', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-crosscheck-bad-'));
  const tree = greenCrossCheckTree();
  tree['docs/current/glossary.md'] = [
    '# glossary.md',
    '',
    '## Entity: Mystery (mystery.yaml)',
    '',
    '| Field | Type | Nullable | Source |',
    '| --- | --- | --- | --- |',
    '| id | string | no | mystery.yaml |',
  ].join('\n');
  tree['docs/current/architecture.md'] = tree['docs/current/architecture.md'].replace('| Build | tsup | tsup.config.ts |\n', '');
  writeTree(root, tree);
  assert.throws(
    () => runCrosschecks(fixtureContext(root)),
    (err: Error) => {
      assert.match(err.message, /docs-gen: cross-check violations \(2\)/);
      assert.ok(
        err.message.includes(
          "glossary-entity-commands: glossary entity 'Mystery (mystery.yaml)' maps to no CLI command or bin"
        )
      );
      assert.ok(err.message.includes("tech-vocabulary: decision technology 'tsup' is missing from the tech stack"));
      return true;
    }
  );
});

test('characterization: STALE-REF is a hard gate check naming the file and the missing path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-crosscheck-stale-'));
  writeTree(root, {
    ...greenCrossCheckTree(),
    'src/policies/errors.yaml': [
      'version: 1',
      'errors:',
      '  SOME_CODE:',
      '    message: Fixture.',
      '    fix: See src/gone.ts.',
    ].join('\n'),
  });
  assert.throws(
    () => runCrosschecks(fixtureContext(root)),
    (err: Error) => {
      assert.match(err.message, /docs-gen: cross-check violations \(1\)/);
      assert.ok(
        err.message.includes('STALE-REF: src/policies/errors.yaml:5 (SOME_CODE): references missing src/gone.ts')
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Crosscheck gate invoked from generateAll (TASK-008): the orchestrator runs
// the gate after the manifest loop, a violation aborts the run naming the
// failing check, and nothing is persisted when the gate fails.
// ---------------------------------------------------------------------------

const GATE_MANIFEST: DocsGenManifest = {
  version: 1,
  files: [
    {
      id: 'dependencies',
      provider: 'dependencies-stub',
      path: 'docs/current/dependencies.md',
      mode: 'file',
    },
  ],
};

const dependenciesStub: FileProvider = {
  mode: 'file',
  render(): string[] {
    return [
      '# dependencies.md',
      '',
      '## Key Dependencies',
      '',
      ...renderTable(
        ['Name', 'Version', 'Role', 'Evidence'],
        [['ajv', '^8', 'schema validation', 'src/mod.ts']]
      ),
      '',
    ];
  },
};

const GATE_REGISTRY = new Map([['dependencies-stub', dependenciesStub]]);

test('generateAll runs the crosscheck gate after the manifest loop (clean tree renders)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-gate-ok-'));
  writeTree(root, greenCrossCheckTree());
  const rendered = generateAll(root, GATE_MANIFEST, GATE_REGISTRY);
  assert.ok(rendered.has('docs/current/dependencies.md'));
  assert.ok(rendered.get('docs/current/dependencies.md')?.content.includes('## Key Dependencies'));
});

test('generateAll aborts naming the failing check and persists nothing on a violation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-gate-bad-'));
  writeTree(root, {
    ...greenCrossCheckTree(),
    'src/policies/errors.yaml': [
      'version: 1',
      'errors:',
      '  SOME_CODE:',
      '    message: Fixture.',
      '    fix: See src/gone.ts.',
    ].join('\n'),
  });
  const before = fs.readFileSync(path.join(root, 'docs/current/dependencies.md'), 'utf8');
  assert.throws(
    () => generateAll(root, GATE_MANIFEST, GATE_REGISTRY),
    (err: Error) => {
      assert.match(err.message, /docs-gen: cross-check violations \(1\)/);
      assert.ok(err.message.includes('STALE-REF:'));
      assert.ok(err.message.includes('references missing src/gone.ts'));
      return true;
    }
  );
  // Nothing is persisted: the failing run leaves every document untouched.
  assert.equal(fs.readFileSync(path.join(root, 'docs/current/dependencies.md'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'docs/current/known-issues.md')), true);
});
