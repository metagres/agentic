/**
 * decisions provider: renders docs/current/decisions.md as a whole-file
 * generator. Rows are extracted from the structured `decisions:` blocks of
 * docs/changes/<slug>/design.yaml, included only for changes whose plan
 * implementation_status is accepted (the same settling condition the
 * knowledge-extraction gate uses — in-flight decisions are never
 * published). Curator-authored rows whose context key is not produced by
 * extraction survive through merge-by-key.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readYaml } from '../../yaml-io.ts';
import { mergeTableRows, renderTable, tableRowsUnderHeading } from '../table.ts';
import type { FileProvider, ProviderContext } from '../types.ts';

const REL_PATH = 'docs/current/decisions.md';
const HEADERS = ['Date', 'Context', 'Decision', 'Rationale', 'Status', 'Evidence'];
const CHANGES_DIR = 'docs/changes';

/**
 * Curated rows: decisions recorded outside the design.yaml extraction,
 * merged by context key like every other row (the key never collides with
 * an extracted slug, so the row survives regeneration).
 */
const CURATED_ROWS: string[][] = [
  [
    '2026-09-10',
    'cli-terminology-contract (DEC-017)',
    'The envelope identity field is renamed to command and the status/changes data key naming the stage to run becomes stage (one term, one meaning — AGENTS.md §2.9); the registry listing flag becomes --list-commands with data key data.commands[], with no compatibility aliases. The delegation-directive machinery is removed from all envelopes, superseding the CMP-002 prepend placement in normalizeEnvelope: envelopes carry facts and actionable next steps only, and delegation rules live solely in the deployed skill, enforced by the deploy-smoke marker phrase.',
    'The word "workflow" named two concepts (the envelope identity field and the pipeline stage to run), and per-envelope delegation prepends duplicated instructions the orchestrator skill already owns while inflating every envelope; the slim status/changes shapes keep the loop actionable through stage, agent, and suggested_command.',
    'accepted',
    'src/scripts/lib/cli.ts, src/schemas/cli-envelope.schema.yaml, bin/deploy-to-agent.ts, src/skills/agentic-sdlc/SKILL.md',
  ],
];

interface DecisionEntry {
  id?: string;
  title?: string;
  context?: string;
  decision?: string;
  status?: string;
}

interface DesignArtifact {
  metadata?: { created?: string; updated?: string; status?: string };
  decisions?: DecisionEntry[];
}

interface PlanArtifact {
  metadata?: { implementation_status?: string };
}

export const decisionsProvider: FileProvider = {
  mode: 'file',
  render(ctx: ProviderContext): string[] {
    const existing = ctx.readExisting(REL_PATH);
    const rows = decisionRows(ctx.root, existing);
    return ['# decisions.md', '', '## Living: Cycle Decisions', '', ...renderTable(HEADERS, rows), ''];
  },
};

function decisionRows(root: string, existing: string): string[][] {
  const existingRows = tableRowsUnderHeading(existing, 'Living: Cycle Decisions');
  const changesDir = path.join(root, CHANGES_DIR);
  const generated: string[][] = [];

  if (fs.existsSync(changesDir)) {
    for (const slug of fs.readdirSync(changesDir).sort()) {
      const changeRoot = path.join(changesDir, slug);
      if (!fs.statSync(path.join(changesDir, slug)).isDirectory()) continue;
      if (!implementationAccepted(changeRoot)) continue;
      const design = readDesignArtifact(path.join(changeRoot, 'design.yaml'));
      if (!design) continue;
      const date = design.metadata?.created ?? design.metadata?.updated ?? '';
      const artifactStatus = design.metadata?.status ?? 'accepted';
      for (const decision of design.decisions ?? []) {
        if (!decision.id) continue;
        generated.push([
          date,
          `${slug} (${decision.id})`,
          decision.decision ?? '',
          decision.context ?? '',
          artifactStatus,
          `${CHANGES_DIR}/${slug}/design.yaml`,
        ]);
      }
    }
  }

  return mergeTableRows(existingRows, [...generated, ...CURATED_ROWS], {
    keyColumn: 1,
    sortBy: 0,
  });
}

function implementationAccepted(changeRoot: string): boolean {
  const plan = readYaml(path.join(changeRoot, 'plan.yaml')) as PlanArtifact | null;
  return plan?.metadata?.implementation_status === 'accepted';
}

function readDesignArtifact(file: string): DesignArtifact | null {
  if (!fs.existsSync(file)) return null;
  try {
    return readYaml(file) as DesignArtifact;
  } catch {
    return null;
  }
}
