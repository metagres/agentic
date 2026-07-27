import path from 'node:path';

import type { ParseArgsResult, WarningItem } from '../lib/types.ts';
import type { DocEntry } from '../lib/docs-index.ts';
import { parseArgs, writeJson, EXIT } from '../lib/cli.ts';
import { writeYamlAtomic } from '../lib/yaml-io.ts';
import { safeReadYaml, requireContract } from '../lib/context.ts';
import { requireChangeRoot } from '../lib/change-root.ts';

import {
  loadDocsIndex,
  headingExists,
} from '../lib/docs-index.ts';

import { today } from '../lib/ids.ts';
import { loadPipeline } from '../lib/policy-loader.ts';
import { makeError } from '../lib/error-catalog.ts';

const FALLBACK_STAGE_ARTIFACTS = [
{
stage: 'requirements',
file: 'requirements.yaml',
phase: 'Requirements',
contract: 'requirements-contract.yaml',
},
{
stage: 'design',
file: 'design.yaml',
phase: 'Design',
contract: 'design-contract.yaml',
},
{
stage: 'planning',
file: 'plan.yaml',
phase: 'Planning',
contract: 'plan-contract.yaml',
},
];

function getStageArtifacts(cwd: string) {
  try {
    const pipeline = loadPipeline(cwd) as Record<string, unknown> | null;
    const pipelineStages = (pipeline?.stages || {}) as Record<string, unknown>;
    const sourceArtifacts =
      (pipelineStages['knowledge-extraction'] as Record<string, unknown>)?.source_artifacts as string[] | undefined;

    const out: { stage: string; file: string; phase: string; contract: string }[] = [];
    for (const [stageId, cfg] of Object.entries(pipelineStages)) {
      if (stageId === 'knowledge-extraction') continue;
      const stageCfg = cfg as Record<string, unknown>;
      if (stageCfg?.produces_delta && stageCfg?.artifact && stageCfg?.delta_phase) {
        if (
          !Array.isArray(sourceArtifacts) ||
          sourceArtifacts.includes(stageCfg.artifact as string)
        ) {
          out.push({
stage: stageId,
file: stageCfg.artifact as string,
phase: stageCfg.delta_phase as string,
contract: stageCfg.contract as string,
});
        }
      }
    }

    if (out.length > 0) return out;
  } catch {
    // Fall back to hardcoded safe defaults.
  }

  return FALLBACK_STAGE_ARTIFACTS;
}


function usage(code = EXIT.ok) {
  writeJson(
    {
      workflow: 'knowledge-extraction',
      step: 'help',
      state: code === EXIT.ok ? 'ok' : 'blocked',
      instructions:
        'Usage: sdlc knowledge-extraction --dir <change-dir> ' +
        '[--stage requirements|design|planning] ' +
        '[--mark-extracted --entry-id DD-... --note "..."] ' +
        '[--mark-extracted --target-doc docs/current/foo.md --note "..."] ' +
        '[--complete]',
      data: {},
      errors: [],
      warnings: [],
    },
    code
  );
}

function hashKey(value: string): string {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function entryKey(entry: Record<string, unknown>): string {
  return [
    entry.source_stage,
    entry.target_doc,
    entry.change,
    String(entry.reason || '').slice(0, 120),
  ].join('|');
}

function entryIdFromKey(key: string): string {
  return `DD-${hashKey(key)}`;
}

export function runKnowledgeExtraction(argv: string[]) {
  const args = parseArgs(argv) as ParseArgsResult;

  if (args.help) {
    usage(EXIT.ok);
  }

  const cwd = args.cwd
    ? path.resolve(String(args.cwd))
    : process.cwd();

  const base: Record<string, unknown> = {
    workflow: 'knowledge-extraction',
    step: 'docs_delta',
  };

  const changeRoot = requireChangeRoot(args, cwd, base);
const stageArtifacts = getStageArtifacts(cwd);
const stageFilter = args.stage;

  if (
    stageFilter &&
    !stageArtifacts.some((cfg) => cfg.stage === stageFilter)
  ) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions:
          'Optional --stage must be one of: requirements, design, planning.',
        data: {
          known_stages: stageArtifacts.map((cfg) => cfg.stage),
        },
        errors: [makeError('UNKNOWN_STAGE_FILTER', { message: `Unknown stage filter: ${stageFilter}` })],
        warnings: [],
      },
      EXIT.usage
    );
  }

  try {
    const collected: Record<string, unknown>[] = [];
    const warnings: WarningItem[] = [];

if (args.complete) {
for (const cfg of stageArtifacts) {
if (stageFilter && cfg.stage !== stageFilter) continue;
if (!cfg.contract) continue;
const contractArtifactPath = path.join(changeRoot!, cfg.file);
if (!safeReadYaml(contractArtifactPath)) continue;
try {
requireContract(cfg.contract, cwd, warnings);
} catch (err: unknown) {
writeJson(
{
...base,
state: 'blocked',
instructions: err instanceof Error ? err.message : String(err),
data: {
change_root: changeRoot,
missing_contract: cfg.contract,
},
errors: [makeError('CONTRACT_MISSING', { message: err instanceof Error ? err.message : String(err) })],
warnings,
},
EXIT.internal
);
return;
}
}
}

    for (const cfg of stageArtifacts) {
      if (stageFilter && cfg.stage !== stageFilter) continue;

      const artifactPath = path.join(changeRoot!, cfg.file);
      const artifact = safeReadYaml(artifactPath) as Record<string, unknown> | null;

      if (!artifact) continue;

      const deltas = Array.isArray(artifact.delta) ? artifact.delta as unknown[] : [];

      deltas.forEach((delta: unknown, idx: number) => {
        collected.push({
          ...(delta as Record<string, unknown>),
          source_stage: cfg.stage,
          source_artifact: cfg.file,
          source_index: idx,
          phase: (delta as Record<string, unknown>).phase || cfg.phase,
        });
      });
    }

    const docs: DocEntry[] = loadDocsIndex(cwd);
    const allowedDocs = new Set(docs.map((d: DocEntry) => d.file));

    if (docs.length === 0) {
      warnings.push({
        code: 'DOCS_INDEX_MISSING',
        message:
          'docs/current/index.md not found; delta target validation was skipped.',
      });
    }

    const validationErrors: Record<string, unknown>[] = [];

    const docsDeltaPath = path.join(changeRoot!, 'docs-delta.yaml');
    const existing = safeReadYaml(docsDeltaPath) as Record<string, unknown> | null;

    const existingEntries: Record<string, unknown>[] = Array.isArray(existing?.entries)
      ? existing.entries as Record<string, unknown>[]
      : [];

    const existingByKey = new Map<string, Record<string, unknown>>(
      existingEntries.map((entry: Record<string, unknown>) => [entry.key as string, entry])
    );

    const entries = collected.map((entry: Record<string, unknown>): Record<string, unknown> => {
      const key = entryKey(entry);
      const prev = existingByKey.get(key) as Record<string, unknown> | undefined;

      return {
        key,
        id: entryIdFromKey(key),
        source_stage: entry.source_stage,
        source_artifact: entry.source_artifact,
        phase: entry.phase,
        target_doc: entry.target_doc,
        target_anchor: entry.target_anchor || null,
        entity_id: entry.entity_id || null,
        change: entry.change,
        reason: entry.reason,
        date: entry.date || today(),
        status: prev?.status === 'extracted' ? 'extracted' : 'pending',
        extracted_at: prev?.extracted_at || null,
        extraction_note: prev?.extraction_note || null,
      };
    });

    // sdlc-hardening: archive
const newKeys = new Set(entries.map((entry: Record<string, unknown>) => entry.key as string));
const archivedEntries: Record<string, unknown>[] = Array.isArray(existing?.archived_entries)
  ? (existing.archived_entries as Record<string, unknown>[]).slice()
  : [];

for (const oldEntry of existingEntries) {
  const alreadyArchived = archivedEntries.some(
    (a: Record<string, unknown>) => a?.key === oldEntry.key || (a?.original_entry as Record<string, unknown>)?.key === oldEntry.key
  );

  if (!newKeys.has(oldEntry.key as string) && !alreadyArchived) {
    archivedEntries.push({
      id: oldEntry.id,
      key: oldEntry.key,
      archived_reason: 'removed_from_source_artifact',
      archived_at: today(),
      original_entry: oldEntry,
    });
  }
}

entries.forEach((entry: Record<string, unknown>) => {
      const label = `${entry.source_artifact} ${entry.id}`;

      if (!entry.target_doc || typeof entry.target_doc !== 'string') {
        validationErrors.push({
          id: entry.id,
          source_stage: entry.source_stage,
          code: 'MISSING_TARGET_DOC',
          message: `${label} requires target_doc`,
        });
      } else if (
        allowedDocs.size > 0 &&
        !allowedDocs.has(entry.target_doc)
      ) {
        validationErrors.push({
          id: entry.id,
          source_stage: entry.source_stage,
          target_doc: entry.target_doc,
          code: 'TARGET_DOC_NOT_IN_INDEX',
          message:
            `${label} target_doc is not listed in docs/current/index.md: ` +
            entry.target_doc,
        });
      }

      if (!['Add', 'Modify', 'Remove'].includes(entry.change as string)) {
        validationErrors.push({
          id: entry.id,
          source_stage: entry.source_stage,
          code: 'INVALID_CHANGE',
          message: `${label} change must be Add, Modify, or Remove`,
        });
      }

      if (!entry.reason || String(entry.reason).trim().length < 10) {
        validationErrors.push({
          id: entry.id,
          source_stage: entry.source_stage,
          code: 'MISSING_REASON',
          message: `${label} requires a specific reason`,
        });
      }

      if (entry.date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date as string)) {
        validationErrors.push({
          id: entry.id,
          source_stage: entry.source_stage,
          code: 'INVALID_DATE',
          message: `${label} date must be YYYY-MM-DD`,
        });
      }

      if (entry.change !== 'Add') {
        if (!entry.target_anchor && !entry.entity_id) {
          validationErrors.push({
            id: entry.id,
            source_stage: entry.source_stage,
            code: 'MISSING_MODIFY_TARGET',
            message: `${label} Modify/Remove requires target_anchor or entity_id`,
          });
        }

        if (
          entry.target_anchor &&
          allowedDocs.size > 0 &&
          entry.target_doc &&
          allowedDocs.has(entry.target_doc as string) &&
          !headingExists(cwd, entry.target_doc as string, entry.target_anchor as string)
        ) {
          validationErrors.push({
            id: entry.id,
            source_stage: entry.source_stage,
            target_doc: entry.target_doc,
            target_anchor: entry.target_anchor,
            code: 'ANCHOR_NOT_FOUND',
            message:
              `${label} target_anchor not found in ${entry.target_doc}: ` +
              entry.target_anchor,
          });
        }
      }
    });

    const plan = safeReadYaml(path.join(changeRoot!, 'plan.yaml')) as Record<string, unknown> | null;

    const implementationStatus =
      (plan?.metadata as Record<string, unknown>)?.implementation_status as string | null || null;

    const implementationOk =
      !plan || implementationStatus === 'accepted';

    if (plan && !implementationOk) {
      warnings.push({
        code: 'IMPLEMENTATION_NOT_ACCEPTED',
        message:
          'plan.yaml implementation_status is not accepted. ' +
          'Complete implementation review before finalizing knowledge extraction.',
      });

      if (args.complete) {
        validationErrors.push({
          id: 'implementation',
          source_stage: 'implementation',
          code: 'IMPLEMENTATION_NOT_ACCEPTED',
          message:
            'plan.yaml implementation_status must be accepted before knowledge extraction can complete.',
        });
      }
    }

    const strictErrors: { code: string; message: string; fix?: string }[] = args.strict
  ? warnings
      .filter((w: WarningItem) =>
        [
          'DOCS_INDEX_MISSING',
          'IMPLEMENTATION_NOT_ACCEPTED',
          'DOCS_DELTA_VALIDATION'
        ].includes(w.code)
      )
      .map((w: WarningItem) => makeError(w.code, { message: w.message }))
  : [];

if (args['mark-extracted']) {
      const note = args.note ? String(args.note) : '';

      if (note.trim().length < 10) {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions:
              '--mark-extracted requires --note with at least 10 characters.',
            data: {
              change_root: changeRoot,
              docs_delta: docsDeltaPath,
            },
            errors: [makeError('MISSING_EXTRACTION_NOTE')],
            warnings,
          },
          EXIT.usage
        );
      }

      let marked = 0;

      if (args['entry-id']) {
        const entryId = String(args['entry-id']);

        for (const entry of entries) {
          if (entry.id === entryId) {
            entry.status = 'extracted';
            entry.extracted_at = today();
            entry.extraction_note = note;
            marked += 1;
          }
        }

        if (marked === 0) {
          writeJson(
            {
              ...base,
              state: 'blocked',
              instructions: `No docs-delta entry found with id: ${entryId}`,
              data: {
                change_root: changeRoot,
                docs_delta: docsDeltaPath,
                entry_id: entryId,
                entries,
              },
              errors: [makeError('ENTRY_ID_NOT_FOUND', { message: `No docs-delta entry found with id: ${entryId}` })],
              warnings,
            },
            EXIT.actionFailed
          );
        }
      } else if (args['target-doc']) {
        const targetDoc = String(args['target-doc']);

        for (const entry of entries) {
          if (entry.target_doc === targetDoc) {
            entry.status = 'extracted';
            entry.extracted_at = today();
            entry.extraction_note = note;
            marked += 1;
          }
        }

        if (marked === 0) {
          writeJson(
            {
              ...base,
              state: 'blocked',
              instructions: `No docs-delta entries found for target_doc: ${targetDoc}`,
              data: {
                change_root: changeRoot,
                docs_delta: docsDeltaPath,
                target_doc: targetDoc,
                entries,
              },
              errors: [makeError('TARGET_DOC_NOT_FOUND', { message: `No docs-delta entries found for target_doc: ${targetDoc}` })],
              warnings,
            },
            EXIT.actionFailed
          );
        }
      } else {
        writeJson(
          {
            ...base,
            state: 'blocked',
            instructions:
              '--mark-extracted requires --entry-id or --target-doc.',
            data: {
              change_root: changeRoot,
              docs_delta: docsDeltaPath,
            },
            errors: [makeError('MISSING_MARK_TARGET')],
            warnings,
          },
          EXIT.usage
        );
      }
    }

    const allExtracted =
      entries.length === 0 ||
      entries.every((entry) => entry.status === 'extracted');

    const canComplete =
      allExtracted &&
      validationErrors.length === 0 &&
      implementationOk;

    const existingMeta = existing?.metadata as Record<string, unknown> | undefined;
    const status =
      args.complete && canComplete
        ? 'complete'
        : canComplete && existingMeta?.status === 'complete'
          ? 'complete'
          : 'pending';

    if (args.complete && !canComplete) {
      const doc = {
        metadata: {
          stage: 'knowledge-extraction',
          status: 'pending',
          created: existingMeta?.created || today(),
          updated: today(),
          change_root: changeRoot,
          implementation_status: implementationStatus,
        },
        validation_errors: validationErrors,
        entries,
        archived_entries: archivedEntries,
      };

      writeYamlAtomic(docsDeltaPath, doc);

      writeJson(
        {
          ...base,
          state: 'blocked',
          instructions:
            'Knowledge extraction cannot be completed yet. ' +
            'Fix validation errors, mark all entries extracted with notes, ' +
            'and ensure implementation review is accepted.',
          data: {
            change_root: changeRoot,
            docs_delta: docsDeltaPath,
            all_extracted: allExtracted,
            can_complete: canComplete,
            implementation_status: implementationStatus,
            validation_errors: validationErrors,
            entries,
          },
          errors: [makeError('CANNOT_COMPLETE', { message: `all_extracted=${allExtracted}, validation_errors=${validationErrors.length}, implementation_accepted=${implementationOk}` })],
          warnings,
        },
        EXIT.actionFailed
      );
    }

    const doc = {
      metadata: {
        stage: 'knowledge-extraction',
        status,
        created: existingMeta?.created || today(),
        updated: today(),
        change_root: changeRoot,
        implementation_status: implementationStatus,
      },
      validation_errors: validationErrors,
      entries,
      archived_entries: archivedEntries,
    };

    writeYamlAtomic(docsDeltaPath, doc);

    let state =
status === 'complete'
        ? 'complete'
        : validationErrors.length > 0
          ? 'blocked'
          : 'in_progress';

    let instructions =
      'Update docs/current according to docs-delta.yaml. ' +
      'After updating each doc, mark the corresponding entry extracted with a note.';

    if (status === 'complete') {
      instructions = 'Documentation is synchronized with the implemented change.';
    } else if (validationErrors.length > 0) {
      instructions =
        'Fix docs-delta validation errors before updating docs/current.';
    } else if (allExtracted) {
      instructions =
        'All docs-delta entries are marked extracted. Run with --complete.';
    }
if (strictErrors.length > 0) {
  state = 'blocked';
  instructions =
    `Strict mode is enabled and ${strictErrors.length} warning(s) are blocking.
` +
    strictErrors.map((e) => `- ${e.code}: ${e.message}`).join('\n');
}



    writeJson(
      {
        ...base,
        state,
        instructions,
        data: {
          change_root: changeRoot,
          docs_delta: docsDeltaPath,
          docs_index: path.join(cwd, 'docs', 'current', 'index.md'),
          status,
          all_extracted: allExtracted,
          can_complete: canComplete,
          implementation_status: implementationStatus,
          pending_count: entries.filter((e) => e.status !== 'extracted').length,
          validation_errors: validationErrors,
          entries,
        },
        errors: strictErrors,
        warnings,
      },
      EXIT.ok
    );
  } catch (err: unknown) {
    writeJson(
      {
        ...base,
        state: 'blocked',
        instructions: err instanceof Error ? err.message : String(err),
        data: {
          change_root: changeRoot,
        },
        errors: [makeError('INTERNAL_ERROR', { message: err instanceof Error ? err.message : String(err) })],
        warnings: [],
      },
      EXIT.internal
    );
  }
}
