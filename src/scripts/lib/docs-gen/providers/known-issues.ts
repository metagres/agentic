/**
 * known-issues provider: renders docs/current/known-issues.md as a
 * whole-file generator. The Markers and Skipped Tests sections are pure
 * scans (findings vanish when the underlying defect is fixed — no
 * merge-by-key here); the Review-Justified section is agent-authored and
 * preserved through its docs-gen region. Dead-reference findings are not
 * rendered here — STALE-REF is enforced as a hard gate check by the
 * crosscheck module (DEC-002).
 */

import { scanCommentMarkers, scanSkippedTests } from '../scans.ts';
import { renderTable } from '../table.ts';
import { readRegion, regionBeginMarker, regionEndMarker } from '../splice.ts';
import type { FileProvider, MarkerFinding, ProviderContext } from '../types.ts';

const REL_PATH = 'docs/current/known-issues.md';
const REVIEW_JUSTIFIED_REGION = 'review-justified';
const MARKER_HEADERS = ['Location', 'Marker', 'Context', 'Evidence'];

export const knownIssuesProvider: FileProvider = {
  mode: 'file',
  render(ctx: ProviderContext): string[] {
    const findings = collectFindings(ctx.root);
    const markersSection =
      findings.length > 0
        ? ['', ...renderTable(MARKER_HEADERS, findings.map(toRow)), '']        : [
            '',
            '- No comment markers found in src/, bin/, or test/ (machine scan).',
            '',
          ];

    const skipped = scanSkippedTests(ctx.root);
    const skippedSection = [
      '',
      '## Skipped Tests',
      '',
      ...(skipped.length > 0
        ? renderTable(
            ['File', 'Line', 'Usage'],
            skipped.map((hit) => [hit.file, String(hit.line), hit.usage])
          )
        : renderTable(['File', 'Test', 'Reason'], [['none', 'No .skip or .only usages found in test/', '—']])),
    ];

    const preserved = readRegion(ctx.readExisting(REL_PATH), REVIEW_JUSTIFIED_REGION);
    if (preserved === null) {
      throw new Error(
        `docs-gen: ${REL_PATH} does not declare the '${REVIEW_JUSTIFIED_REGION}' region — insert the docs-gen markers first (one-time migration)`
      );
    }

    return [
      '# known-issues.md',
      '',
      '## Markers',
      ...markersSection,
      '## Review-Justified Known Issues',
      '',
      regionBeginMarker(REVIEW_JUSTIFIED_REGION),
      ...preserved,
      regionEndMarker(REVIEW_JUSTIFIED_REGION),
      ...skippedSection,
      '## Baseline Disclaimer',
      '',
      'Machine scan. Undocumented issues exist.',
      '',
    ];
  },
};

function toRow(finding: MarkerFinding): string[] {
  return [finding.location, finding.marker, finding.context, finding.evidence];
}

function collectFindings(root: string): MarkerFinding[] {
  const findings: MarkerFinding[] = [];
  for (const hit of scanCommentMarkers(root)) {
    findings.push({
      location: `${hit.file}:${hit.line}`,
      marker: hit.marker,
      context: hit.text,
      severity: 'scan',
      evidence: `${hit.file}:${hit.line}`,
    });
  }
  return findings.sort((a, b) => a.location.localeCompare(b.location) || a.marker.localeCompare(b.marker));
}

export { REVIEW_JUSTIFIED_REGION };
