export interface PolicyFile {
  path: string;
  content: string;
}

export interface PolicyFinding {
  file: string;
  check: string;
  message: string;
}

export interface PolicyContext {
  agentsMd: PolicyFile;
  citationFiles: PolicyFile[];
  docsCurrentFileNames: string[];
  pathExists: (relPath: string) => boolean;
}

export const LINE_CAP = 90;
export const TABLE_LINE_CAP = 16;
export const NPM_RUN_CAP = 6;

export const ALLOWED_SECTIONS = [
  'The One Rule',
  'Invariants',
  'Definition of Done',
  'Session Context Routing',
] as const;

const GHOST_HEADING_PATTERN =
  /terminology|where to find|quick reference|validation layers|stage-folder|repository utilities|when changing/i;

const PATH_ROOT_PATTERN = /^(?:src|bin|docs|test|\.opencode)\/[\w./-]+$/;

export function parseSectionNumbers(content: string): number[] {
  const numbers: number[] = [];
  for (const match of content.matchAll(/^##\s+(\d+)\./gm)) {
    numbers.push(Number(match[1]));
  }
  return numbers;
}

export function parseInvariantNumbers(content: string): number[] {
  const lines = content.split('\n');
  let inInvariants = false;
  const numbers = new Set<number>();
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      inInvariants = line.includes('Invariants');
      continue;
    }
    if (!inInvariants) {
      continue;
    }
    const match = line.match(/^(\d+)\.\s/);
    if (match) {
      numbers.add(Number(match[1]));
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

export interface AgentsMdCitation {
  kind: 'section' | 'invariant';
  numbers: number[];
}

export function extractAgentsMdCitations(content: string): AgentsMdCitation[] {
  const citations: AgentsMdCitation[] = [];
  for (const line of content.split('\n')) {
    if (!/AGENTS\.md/i.test(line)) {
      continue;
    }
    const sectionNumbers: number[] = [];
    for (const match of line.matchAll(/(?:§|\bsection\s+)(\d+)/gi)) {
      sectionNumbers.push(Number(match[1]));
    }
    if (sectionNumbers.length > 0) {
      citations.push({ kind: 'section', numbers: sectionNumbers });
    }
    const invariantNumbers: number[] = [];
    for (const match of line.matchAll(/\binvariants?\s+(\d+(?:\s+and\s+\d+)*)/gi)) {
      for (const part of match[1].split(/\s+and\s+/)) {
        invariantNumbers.push(Number(part));
      }
    }
    if (invariantNumbers.length > 0) {
      citations.push({ kind: 'invariant', numbers: invariantNumbers });
    }
  }
  return citations;
}

function findHeadingFindings(agentsMd: PolicyFile): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  const seen = new Set<string>();
  for (const line of agentsMd.content.split('\n')) {
    if (/^```/.test(line)) {
      continue;
    }
    if (/^#{2,3}\s/.test(line) && GHOST_HEADING_PATTERN.test(line)) {
      findings.push({
        file: agentsMd.path,
        check: 'ghost-heading',
        message: `heading restates content that belongs in docs/current: ${line.trim()}`,
      });
    }
    const match = line.match(/^##\s+(\d+\.\s+)?(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const title = match[2];
    if (!(ALLOWED_SECTIONS as readonly string[]).includes(title)) {
      findings.push({
        file: agentsMd.path,
        check: 'section-allowlist',
        message: `H2 section '${title}' is not in the allowlist (${ALLOWED_SECTIONS.join(', ')})`,
      });
      continue;
    }
    if (seen.has(title)) {
      findings.push({
        file: agentsMd.path,
        check: 'section-allowlist',
        message: `H2 section '${title}' appears more than once`,
      });
    }
    seen.add(title);
  }
  return findings;
}

function extractBacktickPaths(content: string): string[] {
  const paths: string[] = [];
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1];
    if (PATH_ROOT_PATTERN.test(span) && !paths.includes(span)) {
      paths.push(span);
    }
  }
  return paths;
}

export function lintAgentsMarkdown(ctx: PolicyContext): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  const { agentsMd, citationFiles, docsCurrentFileNames, pathExists } = ctx;
  const content = agentsMd.content;
  const lines = content.split('\n');

  if (lines.length > LINE_CAP) {
    findings.push({
      file: agentsMd.path,
      check: 'line-cap',
      message: `AGENTS.md has ${lines.length} lines (cap ${LINE_CAP}) — descriptive content belongs in docs/current`,
    });
  }

  findings.push(...findHeadingFindings(agentsMd));

  if (content.includes('```')) {
    findings.push({
      file: agentsMd.path,
      check: 'no-fenced-code',
      message: 'fenced code blocks are prohibited — commands live in docs/current/operations.md',
    });
  }

  const npmRunCount = (content.match(/npm run /g) ?? []).length;
  if (npmRunCount > NPM_RUN_CAP) {
    findings.push({
      file: agentsMd.path,
      check: 'npm-run-cap',
      message: `${npmRunCount} 'npm run' mentions (cap ${NPM_RUN_CAP}) — command enumerations belong in docs/current/operations.md`,
    });
  }

  const tableLineCount = lines.filter((line) => /^\s*\|/.test(line)).length;
  if (tableLineCount > TABLE_LINE_CAP) {
    findings.push({
      file: agentsMd.path,
      check: 'table-cap',
      message: `${tableLineCount} table lines (cap ${TABLE_LINE_CAP}) — only the session-context routing table is allowed`,
    });
  }

  const sectionNumbers = new Set(parseSectionNumbers(content));
  const invariantNumbers = new Set(parseInvariantNumbers(content));

  for (const file of citationFiles) {
    for (const citation of extractAgentsMdCitations(file.content)) {
      const valid =
        citation.kind === 'section' ? sectionNumbers : invariantNumbers;
      const label = citation.kind === 'section' ? 'section' : 'invariant';
      for (const n of citation.numbers) {
        if (!valid.has(n)) {
          findings.push({
            file: file.path,
            check: 'citation-integrity',
            message: `dead AGENTS.md ${label} reference '${label} ${n}' — valid ${label}s: ${[...valid].sort((a, b) => a - b).join(', ')}`,
          });
        }
      }
    }
  }

  for (const name of docsCurrentFileNames) {
    if (!content.includes(`docs/current/${name}`)) {
      findings.push({
        file: agentsMd.path,
        check: 'routing-completeness',
        message: `docs/current/${name} is missing from the session-context routing table`,
      });
    }
  }

  // Reverse direction (DEC-006): every docs/current/<name>.md mention in
  // AGENTS.md — table cells, backticks, or prose — must exist in docs/current.
  // The scope is exactly docs/current/<name>.md mentions, so docs/changes/
  // and docs/ideas/ references are never flagged by it.
  for (const match of content.matchAll(/docs\/current\/([\w.-]+\.md)/g)) {
    const name = match[1];
    if (!docsCurrentFileNames.includes(name)) {
      findings.push({
        file: agentsMd.path,
        check: 'phantom-doc-reference',
        message: `AGENTS.md references docs/current/${name}, which does not exist in docs/current`,
      });
    }
  }

  for (const relPath of extractBacktickPaths(content)) {
    const trimmed = relPath.replace(/\/+$/, '');
    if (trimmed.length > 0 && !pathExists(trimmed)) {
      findings.push({
        file: agentsMd.path,
        check: 'path-existence',
        message: `referenced path does not exist: ${relPath}`,
      });
    }
  }

  return findings;
}
