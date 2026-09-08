import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAgentsMdCitations,
  lintAgentsMarkdown,
  parseInvariantNumbers,
  parseSectionNumbers,
  type PolicyContext,
  type PolicyFile,
} from '../../src/scripts/lib/agents-md-policy.ts';

const VALID_AGENTS_MD = [
  '# AGENTS.md — Mandatory Rules for AI Coding Agents',
  '',
  '## 1. The One Rule',
  '',
  'Any change touching code or YAML is complete only when `npm run validate` passes.',
  'Full coverage: `npm run check:all`. Command semantics: docs/current/operations.md.',
  '',
  '## 2. Invariants',
  '',
  '1. Stage folders are the structural source of truth.',
  '2. The CLI owns lifecycle state transitions.',
  '3. Review history is append-only.',
  '4. Authoring stages produce delta entries.',
  '',
  '## 3. Definition of Done',
  '',
  '- `npm run validate` passes.',
  '',
  '## 4. Session Context Routing',
  '',
  'Start from docs/current/index.md.',
  '',
  '| Session goal | Read |',
  '|---|---|',
  '| Commands and verification | docs/current/operations.md |',
  '| Data shapes | docs/current/glossary.md |',
].join('\n');

const ALL_DOCS = [
  'index.md',
  'operations.md',
  'glossary.md',
  'architecture.md',
  'conventions.md',
  'decisions.md',
  'capabilities.md',
  'api-contract.md',
  'dependencies.md',
  'known-issues.md',
];

function file(path: string, content: string): PolicyFile {
  return { path, content };
}

function baseContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    agentsMd: { path: 'AGENTS.md', content: VALID_AGENTS_MD },
    citationFiles: [],
    docsCurrentFileNames: ['index.md', 'operations.md', 'glossary.md'],
    pathExists: () => true,
    ...overrides,
  };
}

test('a compliant AGENTS.md produces no findings', () => {
  const findings = lintAgentsMarkdown(
    baseContext({
      citationFiles: [
        { path: 'docs/current/glossary.md', content: 'Evidence: AGENTS.md (invariant 3), src/scripts/lib/requires-graph.ts' },
      ],
    })
  );
  assert.deepEqual(findings, []);
});

test('line cap is enforced', () => {
  const long = [...VALID_AGENTS_MD.split('\n'), ...Array.from({ length: 90 }, () => 'filler')].join('\n');
  const findings = lintAgentsMarkdown(baseContext({ agentsMd: { path: 'AGENTS.md', content: long } }));
  assert.ok(findings.some((f) => f.check === 'line-cap'));
});

test('unknown and ghost H2 sections are rejected', () => {
  const content = `${VALID_AGENTS_MD}\n\n## 5. Terminology\n\nstage means workflow.\n`;
  const findings = lintAgentsMarkdown(baseContext({ agentsMd: { path: 'AGENTS.md', content } }));
  const checks = findings.filter((f) => f.check === 'section-allowlist' || f.check === 'ghost-heading');
  assert.ok(checks.some((f) => f.message.includes('Terminology')));
});

test('fenced code blocks are rejected', () => {
  const content = `${VALID_AGENTS_MD}\n\n\`\`\`bash\nnpm run validate\n\`\`\`\n`;
  const findings = lintAgentsMarkdown(baseContext({ agentsMd: { path: 'AGENTS.md', content } }));
  assert.ok(findings.some((f) => f.check === 'no-fenced-code'));
});

test('npm run mention cap is enforced', () => {
  const content = `${VALID_AGENTS_MD}\n\nExtra: npm run a, npm run b, npm run c, npm run d.\n`;
  const findings = lintAgentsMarkdown(baseContext({ agentsMd: { path: 'AGENTS.md', content } }));
  assert.ok(findings.some((f) => f.check === 'npm-run-cap'));
});

test('table cap is enforced', () => {
  const rows = Array.from({ length: 20 }, (_, i) => `| goal ${i} | doc |`).join('\n');
  const content = `${VALID_AGENTS_MD}\n${rows}\n`;
  const findings = lintAgentsMarkdown(baseContext({ agentsMd: { path: 'AGENTS.md', content } }));
  assert.ok(findings.some((f) => f.check === 'table-cap'));
});

test('dead invariant citations in citation files are rejected', () => {
  const findings = lintAgentsMarkdown(
    baseContext({
      citationFiles: [
        { path: 'docs/current/glossary.md', content: 'Evidence: AGENTS.md (invariant 99)' },
      ],
    })
  );
  const citationFindings = findings.filter((f) => f.check === 'citation-integrity');
  assert.equal(citationFindings.length, 1);
  assert.equal(citationFindings[0].file, 'docs/current/glossary.md');
  assert.ok(citationFindings[0].message.includes('invariant 99'));
});

test('dead section citations are rejected while valid ones pass', () => {
  const findings = lintAgentsMarkdown(
    baseContext({
      citationFiles: [
        {
          path: 'docs/current/operations.md',
          content: 'AGENTS.md §5\nAGENTS.md (invariant 3)\n',
        },
      ],
    })
  );
  const citationFindings = findings.filter((f) => f.check === 'citation-integrity');
  assert.equal(citationFindings.length, 1);
  assert.ok(citationFindings[0].message.includes('section 5'));
});

test('invariant ranges with "and" resolve each number', () => {
  const findings = lintAgentsMarkdown(
    baseContext({
      citationFiles: [
        { path: 'docs/current/capabilities.md', content: 'AGENTS.md invariants 3 and 99' },
      ],
    })
  );
  const citationFindings = findings.filter((f) => f.check === 'citation-integrity');
  assert.equal(citationFindings.length, 1);
  assert.ok(citationFindings[0].message.includes('invariant 99'));
});

test('a docs/current file missing from the routing table is rejected', () => {
  const findings = lintAgentsMarkdown(
    baseContext({ docsCurrentFileNames: ['index.md', 'operations.md', 'glossary.md', 'known-issues.md'] })
  );
  const routing = findings.filter((f) => f.check === 'routing-completeness');
  assert.equal(routing.length, 1);
  assert.ok(routing[0].message.includes('docs/current/known-issues.md'));
});

test('nonexistent backticked repo paths are rejected', () => {
  const content = `${VALID_AGENTS_MD}\n\nSee \`src/scripts/lib/does-not-exist.ts\`.\n`;
  const findings = lintAgentsMarkdown(
    baseContext({
      agentsMd: { path: 'AGENTS.md', content },
      pathExists: (rel) => rel !== 'src/scripts/lib/does-not-exist.ts',
    })
  );
  const paths = findings.filter((f) => f.check === 'path-existence');
  assert.equal(paths.length, 1);
  assert.ok(paths[0].message.includes('src/scripts/lib/does-not-exist.ts'));
});

test('non-path and relative-looking backtick spans are ignored', () => {
  const content = `${VALID_AGENTS_MD}\n\nTerms: \`stage/kind/gate/step/state/status\` and \`npm run validate\`.\n`;
  const findings = lintAgentsMarkdown(baseContext({ agentsMd: { path: 'AGENTS.md', content } }));
  assert.deepEqual(findings.filter((f) => f.check === 'path-existence'), []);
});

test('section and invariant parsers read AGENTS.md structure', () => {
  assert.deepEqual(parseSectionNumbers(VALID_AGENTS_MD), [1, 2, 3, 4]);
  assert.deepEqual(parseInvariantNumbers(VALID_AGENTS_MD), [1, 2, 3, 4]);
});

test('citation extraction ignores lines without an AGENTS.md mention', () => {
  assert.deepEqual(extractAgentsMdCitations('invariant 3 and section 5'), []);
  assert.deepEqual(extractAgentsMdCitations('AGENTS.md (terminology)'), []);
  assert.deepEqual(extractAgentsMdCitations('AGENTS.md (invariant 8)'), [
    { kind: 'invariant', numbers: [8] },
  ]);
  assert.deepEqual(extractAgentsMdCitations('AGENTS.md §2.4/§2.5'), [
    { kind: 'section', numbers: [2, 2] },
  ]);
});
