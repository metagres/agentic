/**
 * Reviewer findings file validator and known-id target resolver (CMP-003).
 *
 * Parses the --findings YAML document (DM-002) — a reviewer-supplied document
 * with two optional sections: semantic (an array of {check_id, status,
 * evidence} items, validated by the semantic walk validator, CMP-004) and
 * findings (an array of {target, finding, fix?} entries). Each findings entry
 * requires target and finding with fix optional; a missing required field
 * refuses the invocation naming the offending entry with FINDINGS_ENTRY_INVALID
 * and nothing written (AC-012). Entries are normalized to {target, finding,
 * fix?} and any supplied severity is dropped so no per-finding severity is
 * ever recorded (FR-008, AC-014, AC-015).
 *
 * Target resolution rides the known-id universe (DM-004, DEC-001): every
 * string value matching ^[A-Z]{2,6}-[0-9]{2,4}$ collected by recursively
 * walking the YAML documents in the change root (requirements.yaml,
 * design.yaml, plan.yaml, review files) without per-stage hardcoding. A
 * target containing a standalone id-shaped token must resolve into the
 * universe, else an UNKNOWN_FINDING_TARGET warning names the target while the
 * round is still recorded (AC-013); a target with no id-shaped token is a
 * free-text anchor, skips resolution, and never warns. Documented blind spot
 * (design-review round-2 follow-up note 5, advisory): the pattern excludes
 * single-letter-prefixed ids such as F-001, so targets referencing them are
 * classified as free text and never warn — widening the pattern is a
 * design-review event, not an implementation decision.
 */

import path from 'node:path';
import fs from 'node:fs';

import { safeReadYaml } from './context.ts';
import { readYaml } from './yaml-io.ts';
import type { WarningItem } from './types.ts';

/** DM-004 id pattern: 2-6 uppercase letters, hyphen, 2-4 digits. */
export const ID_PATTERN = /^[A-Z]{2,6}-[0-9]{2,4}$/;

/** Standalone id-shaped token inside a longer target string. */
const ID_TOKEN_PATTERN = /[A-Z]{2,6}-[0-9]{2,4}/g;

export interface ReviewerFinding {
  target: string;
  finding: string;
  fix?: string;
}

export interface ParsedFindingsFile {
  /** Raw semantic section items; shape-validated by the CMP-004 validator. */
  semantic: unknown[] | null;
  findings: ReviewerFinding[];
}

export interface SemanticWalkResult {
  check_id: string;
  status: string;
  evidence: string;
}

export interface ValidatedSemanticWalk {
  results: SemanticWalkResult[];
}

/** Validation failure carrying the error-catalog code for the envelope. */
export class FindingsFileError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FindingsFileError';
    this.code = code;
  }
}

/**
 * Parses and shape-validates the --findings YAML document (DM-002). Throws
 * FindingsFileError with the FINDINGS_ENTRY_INVALID code naming the offending
 * entry when a required field is missing (AC-012).
 */
export function parseFindingsFile(filePath: string): ParsedFindingsFile {
  const doc = readYaml(filePath) as unknown;

  if (doc === null || doc === undefined) {
    throw new FindingsFileError(
      'FINDINGS_ENTRY_INVALID',
      `--findings file is empty or unreadable: ${filePath}`
    );
  }

  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new FindingsFileError(
      'FINDINGS_ENTRY_INVALID',
      `--findings file must contain a YAML object with optional semantic and findings sections: ${filePath}`
    );
  }

  const record = doc as Record<string, unknown>;
  const semanticRaw = record.semantic;
  const findingsRaw = record.findings;

  if (semanticRaw !== undefined && semanticRaw !== null && !Array.isArray(semanticRaw)) {
    throw new FindingsFileError(
      'SEMANTIC_WALK_INVALID',
      'The --findings semantic section must be an array of {check_id, status, evidence} items.'
    );
  }

  const findings: ReviewerFinding[] = [];

  if (findingsRaw !== undefined && findingsRaw !== null) {
    if (!Array.isArray(findingsRaw)) {
      throw new FindingsFileError(
        'FINDINGS_ENTRY_INVALID',
        'The --findings findings section must be an array of {target, finding, fix?} entries.'
      );
    }

    findingsRaw.forEach((raw: unknown, idx: number) => {
      const entry =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null;

      if (
        !entry ||
        typeof entry.target !== 'string' ||
        !entry.target.trim() ||
        typeof entry.finding !== 'string' ||
        !entry.finding.trim()
      ) {
        throw new FindingsFileError(
          'FINDINGS_ENTRY_INVALID',
          `--findings entry ${idx} is missing its required target or finding field.`
        );
      }

      // Normalization drops any supplied severity: no per-finding severity is
      // ever read or recorded (FR-008, AC-014, AC-015).
      const normalized: ReviewerFinding = {
        target: entry.target,
        finding: entry.finding,
      };
      if (typeof entry.fix === 'string' && entry.fix.trim()) {
        normalized.fix = entry.fix;
      }
      findings.push(normalized);
    });
  }

  return {
    semantic: Array.isArray(semanticRaw) ? semanticRaw : null,
    findings,
  };
}

/**
 * Builds the known-id universe (DM-004): every string value matching the id
 * pattern, collected by recursively walking the YAML documents under the
 * change root. Unreadable or invalid YAML files are skipped quietly so a
 * single broken document cannot break target resolution.
 */
export function collectKnownIds(changeRoot: string): Set<string> {
  const ids = new Set<string>();

  const collect = (node: unknown): void => {
    if (typeof node === 'string') {
      if (ID_PATTERN.test(node)) ids.add(node);
    } else if (Array.isArray(node)) {
      for (const item of node) collect(item);
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node as Record<string, unknown>)) collect(value);
    }
  };

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        const doc = safeReadYaml(full);
        if (doc !== null) collect(doc);
      }
    }
  };

  walk(changeRoot);
  return ids;
}

/**
 * Classifies each finding target against the DM-004 id pattern (DEC-001) and
 * resolves id-shaped targets against the known-id universe. An unresolved
 * id-shaped target yields one UNKNOWN_FINDING_TARGET warning naming the
 * target; the round is still recorded (AC-013). Free-text targets skip
 * resolution and never warn.
 */
export function resolveFindingTargets(
  findings: ReviewerFinding[],
  knownIds: Set<string>
): WarningItem[] {
  const warnings: WarningItem[] = [];

  for (const finding of findings) {
    const tokens = finding.target.match(ID_TOKEN_PATTERN) || [];
    const unknown = tokens.find((token) => !knownIds.has(token));
    if (unknown) {
      warnings.push({
        code: 'UNKNOWN_FINDING_TARGET',
        message: `Finding target '${finding.target}' contains id '${unknown}' matching no known artifact id.`,
      });
    }
  }

  return warnings;
}

/**
 * Semantic walk validator (CMP-004, DEC-003): validates the reviewer-supplied
 * semantic section against the reviewed (target) stage's semantic-checks.yaml
 * check list — exactly what semanticChecksFor(trackedStage) reads; review
 * stages carry no semantic-checks.yaml of their own. Every check must appear
 * exactly once as a {check_id, status, evidence} item with non-empty evidence
 * (DM-003, FR-010, AC-016). When `required` (--accept with passing mechanical
 * checks) the section itself is required and every status must be 'pass'; a
 * missing, incomplete, or failing walk refuses the invocation with
 * SEMANTIC_WALK_INVALID and nothing written (FR-011, AC-017). The CLI
 * validates the shape, completeness, and status values of reviewer-supplied
 * results only; it never evaluates the semantic checks themselves — they stay
 * agent-walked (DEC-003 boundary).
 */
export function validateSemanticWalk(
  semantic: unknown[] | null,
  stageChecks: string[],
  required: boolean
): ValidatedSemanticWalk | null {
  if (!semantic || semantic.length === 0) {
    if (required) {
      throw new FindingsFileError(
        'SEMANTIC_WALK_INVALID',
        'Acceptance requires the complete semantic walk: supply a semantic section with one {check_id, status, evidence} item per check of the target stage\'s semantic-checks.yaml, all status \'pass\'.'
      );
    }
    return null;
  }

  const results: SemanticWalkResult[] = [];
  const seen = new Map<string, number>();

  semantic.forEach((raw: unknown, idx: number) => {
    const item =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;

    const checkId = typeof item?.check_id === 'string' ? item.check_id.trim() : '';
    const status = typeof item?.status === 'string' ? item.status.trim() : '';
    const evidence = typeof item?.evidence === 'string' ? item.evidence.trim() : '';

    if (!checkId || !status || !evidence) {
      throw new FindingsFileError(
        'SEMANTIC_WALK_INVALID',
        `Semantic result ${idx} must carry check_id, status, and non-empty evidence.`
      );
    }

    if (!stageChecks.includes(checkId)) {
      throw new FindingsFileError(
        'SEMANTIC_WALK_INVALID',
        `Semantic result ${idx} names a check_id that is not a check of the target stage's semantic-checks.yaml: "${checkId.slice(0, 80)}".`
      );
    }

    seen.set(checkId, (seen.get(checkId) || 0) + 1);
    results.push({ check_id: checkId, status, evidence });
  });

  const missing = stageChecks.filter((c) => !seen.has(c));
  if (missing.length > 0) {
    throw new FindingsFileError(
      'SEMANTIC_WALK_INVALID',
      `The semantic walk is incomplete: ${missing.length} check(s) of the target stage's semantic-checks.yaml have no result, starting with "${missing[0].slice(0, 80)}".`
    );
  }

  const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([c]) => c);
  if (duplicated.length > 0) {
    throw new FindingsFileError(
      'SEMANTIC_WALK_INVALID',
      `The semantic walk carries duplicate results for ${duplicated.length} check(s), starting with "${duplicated[0].slice(0, 80)}".`
    );
  }

  if (required) {
    const failing = results.filter((r) => r.status !== 'pass');
    if (failing.length > 0) {
      throw new FindingsFileError(
        'SEMANTIC_WALK_INVALID',
        `Acceptance requires every semantic result status to be 'pass'; ${failing.length} result(s) carry another status, starting with "${failing[0].check_id.slice(0, 80)}".`
      );
    }
  }

  return { results };
}
