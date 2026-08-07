// Text-level lint checks that JSON schemas cannot express.
// These enforce wording/structure rules (Given/When/Then, forbidden words,
// sentence counts) that are not representable as schema constraints.

export interface LintFinding {
  check: string;
  severity: string; // "blocking" | "minor"
  category: string; // "ambiguity" | "completeness" | "structural"
  target: string; // field path like "acceptance_criteria[0].statement"
  finding: string; // human-readable message
  fix: string; // how to fix
}

// Whole-word, case-insensitive match for a phrase (may contain spaces).
function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

// Count sentences by splitting on [.!?]+ and counting non-empty segments.
function countSentences(text: string): number {
  if (!text) return 0;
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

const BLOCKING_WORDS = [
  'fast',
  'user-friendly',
  'gracefully',
  'appropriately',
  'it works',
  'it handles',
  'easy',
  'simple',
  'robust',
  'seamless',
  'intuitive',
  'optimal',
  'as needed',
];

const ADVISORY_WORDS = [
  'should',
  'reasonable',
  'sufficient',
  'normal',
  'expected',
  'proper',
  'maybe',
  'probably',
];

export function runLintChecks(
  stageId: string,
  artifact: Record<string, unknown>
): LintFinding[] {
  if (stageId !== 'requirements' && stageId !== 'design') {
    return [];
  }

  const findings: LintFinding[] = [];

  if (stageId === 'requirements') {
    // 1. Given/When/Then structure for each acceptance criterion.
    const acs = Array.isArray(artifact.acceptance_criteria)
      ? (artifact.acceptance_criteria as Record<string, unknown>[])
      : [];
    acs.forEach((ac, i) => {
      const statement = String(ac.statement || '');
      const target = `acceptance_criteria[${i}].statement`;
      const missing = ['given', 'when', 'then'].filter(
        (kw) => !hasWord(statement, kw)
      );
      if (missing.length > 0) {
        findings.push({
          check: 'given-when-then',
          severity: 'blocking',
          category: 'ambiguity',
          target,
          finding: `${target} is missing keyword(s): ${missing.join(', ')}.`,
          fix: 'Restructure as Given <state>, When <action>, Then <result>',
        });
      }
    });

    // 2. Forbidden words across requirement text fields.
    const textFields: { value: string; target: string }[] = [];
    if (typeof artifact.problem_statement === 'string') {
      textFields.push({
        value: artifact.problem_statement,
        target: 'problem_statement',
      });
    }
    const frs = Array.isArray(artifact.functional_requirements)
      ? (artifact.functional_requirements as Record<string, unknown>[])
      : [];
    frs.forEach((fr, i) => {
      if (typeof fr.description === 'string') {
        textFields.push({
          value: fr.description,
          target: `functional_requirements[${i}].description`,
        });
      }
    });
    const nfrs = Array.isArray(artifact.non_functional_requirements)
      ? (artifact.non_functional_requirements as Record<string, unknown>[])
      : [];
    nfrs.forEach((nfr, i) => {
      if (typeof nfr.description === 'string') {
        textFields.push({
          value: nfr.description,
          target: `non_functional_requirements[${i}].description`,
        });
      }
    });
    acs.forEach((ac, i) => {
      if (typeof ac.statement === 'string') {
        textFields.push({
          value: ac.statement,
          target: `acceptance_criteria[${i}].statement`,
        });
      }
    });
    for (const field of textFields) {
      forbiddenWords(field.value, field.target, findings);
    }

    // 3. Sentence count for problem_statement (1-6).
    if (typeof artifact.problem_statement === 'string') {
      const n = countSentences(artifact.problem_statement);
      if (n < 1 || n > 6) {
        findings.push({
          check: 'sentence-count',
          severity: 'minor',
          category: 'completeness',
          target: 'problem_statement',
          finding: `problem_statement has ${n} sentence(s); expected 1 to 6.`,
          fix: 'Use 1 to 6 sentences',
        });
      }
    }
  }

  if (stageId === 'design') {
    // 3. Sentence count for context_summary (1-12).
    if (typeof artifact.context_summary === 'string') {
      const n = countSentences(artifact.context_summary);
      if (n < 1 || n > 12) {
        findings.push({
          check: 'sentence-count',
          severity: 'minor',
          category: 'completeness',
          target: 'context_summary',
          finding: `context_summary has ${n} sentence(s); expected 1 to 12.`,
          fix: 'Use 1 to 12 sentences',
        });
      }
    }
  }

  return findings;
}

function forbiddenWords(
  text: string,
  target: string,
  findings: LintFinding[]
): void {
  for (const word of BLOCKING_WORDS) {
    if (hasWord(text, word)) {
      findings.push({
        check: 'forbidden-word',
        severity: 'blocking',
        category: 'ambiguity',
        target,
        finding: `"${word}" is a blocking word in ${target}.`,
        fix: 'Replace with concrete metric/condition',
      });
      return;
    }
  }
  for (const word of ADVISORY_WORDS) {
    if (hasWord(text, word)) {
      findings.push({
        check: 'forbidden-word',
        severity: 'minor',
        category: 'ambiguity',
        target,
        finding: `"${word}" is an advisory word in ${target}.`,
        fix: 'Prefer must/shall and concrete conditions where possible',
      });
      return;
    }
  }
}