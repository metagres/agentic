import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, writeJson, EXIT, resolveCwd } from '../lib/cli.ts';
import { makeError } from '../lib/error-catalog.ts';
import { resolveRuntimeDir } from '../lib/paths.ts';
import { loadStageRegistry } from '../lib/stage-registry.ts';
import { computePipelineOrder } from '../lib/requires-graph.ts';
import {
  resolveRootOrError,
  ResolveRootError,
} from '../lib/resolve-root.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function findManifest() {
  const candidates = [
    path.resolve(scriptDir, '..', 'manifest.json'),
    path.resolve(scriptDir, '..', '..', 'manifest.json'),
    path.resolve(scriptDir, '..', '..', '..', 'manifest.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function runDoctor(argv: string[]): void {
  const args = parseArgs(argv);
  const cwd = resolveCwd(args);
  const strict = Boolean(args.strict);

  const checks: { id: string; passed: boolean; details: string }[] = [];
  const errors: { code: string; message: string }[] = [];
  const warnings: { code: string; message: string }[] = [];

  function addCheck(id: string, passed: boolean, details: string = ''): void {
    checks.push({ id, passed, details });
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (Number.isInteger(nodeMajor) && nodeMajor >= 20) {
    addCheck('node_version', true, process.versions.node);
  } else {
    addCheck('node_version', false, process.versions.node);
    errors.push(
      makeError('NODE_VERSION_UNSUPPORTED', {
        message: `Node ${process.versions.node} is not supported. Use Node 20 or newer.`,
      })
    );
  }

  const schemasDir = resolveRuntimeDir('schemas', cwd);
  if (schemasDir) {
    addCheck('schemas_available', true, schemasDir);
    const envelopeSchema = path.join(schemasDir, 'cli-envelope.schema.yaml');
    if (fs.existsSync(envelopeSchema)) {
      addCheck('cli_envelope_schema', true, envelopeSchema);
    } else {
      addCheck('cli_envelope_schema', false, envelopeSchema);
      errors.push({
        ...makeError('SCHEMAS_MISSING'),
        message: 'cli-envelope.schema.yaml not found.',
      });
    }
  } else {
    addCheck('schemas_available', false, 'No schemas directory found');
    errors.push({
      ...makeError('SCHEMAS_MISSING'),
      message: 'No schemas directory found.',
    });
  }

  const policiesDir = resolveRuntimeDir('policies', cwd);
  if (policiesDir) {
    addCheck('policies_available', true, policiesDir);
  } else {
    addCheck('policies_available', false, 'No policies directory found');
    errors.push({
      ...makeError('POLICIES_MISSING'),
      message: 'No policies directory found.',
    });
  }

  const stagesDir = resolveRuntimeDir('stages', cwd);
  if (stagesDir) {
    addCheck('stages_available', true, stagesDir);

    try {
      // Registry discovery validates every stage folder: descriptors against
      // the meta-schema, folder/id match, known kind, and per-kind file sets.
      const registry = loadStageRegistry(cwd);
      addCheck('stage_folders', true, `${registry.length} stage folders discovered`);

      // The requires graph must be a valid DAG with no missing references.
      const order = computePipelineOrder(cwd);
      addCheck('requires_dag', true, `${order.length} stages ordered: ${order.join(', ')}`);
    } catch (err: unknown) {
      addCheck('stage_folders', false, err instanceof Error ? err.message : String(err));
      addCheck('requires_dag', false, err instanceof Error ? err.message : String(err));
      errors.push(
        makeError('STAGE_INVALID_DESCRIPTOR', {
          message: err instanceof Error ? err.message : String(err),
        })
      );
    }
  } else {
    addCheck('stages_available', false, 'No stages directory found');
    errors.push({
      ...makeError('POLICIES_MISSING'),
      message: 'No stages directory found.',
    });
  }

  const manifestPath = findManifest();
  if (manifestPath) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const requiredFields = [
        'name',
        'version',
        'cliPath',
      ];
      const missing = requiredFields.filter(
        (field) => manifest[field] === undefined
      );
      if (missing.length > 0) {
        addCheck('deployed_manifest', false, manifestPath);
        errors.push(
          makeError('MANIFEST_INVALID', {
            message: `Manifest is missing fields: ${missing.join(', ')}`,
          })
        );
      } else {
        addCheck('deployed_manifest', true, manifestPath);
      }
    } catch (err: unknown) {
      addCheck('deployed_manifest', false, manifestPath);
      errors.push(makeError('MANIFEST_INVALID', { message: err instanceof Error ? err.message : String(err) }));
    }
  } else {
    addCheck('deployed_manifest', true, 'skipped; not a deployed runtime');
  }

  let changeSearched: string | undefined;
  if (args.change) {
    try {
      const changeRoot = resolveRootOrError(String(args.change), { cwd });
      addCheck('change_name', true, changeRoot);
    } catch (err: unknown) {
      addCheck('change_name', false, String(args.change));
      if (err instanceof ResolveRootError) {
        changeSearched = err.searched || undefined;
        errors.push(
          makeError(
            err.candidates && err.candidates.length > 0
              ? 'AMBIGUOUS_CHANGE_DIR'
              : 'CHANGE_DIR_NOT_FOUND',
            {
              message: err.message,
              candidates: err.candidates || [],
              available_changes: err.available || [],
              searched: err.searched || undefined,
              ...(err.available.length > 0
                ? { fix: 'Use one of data.available_changes as --change (the exact name or a unique part of it).' }
                : {}),
            }
          )
        );
      } else {
        errors.push(makeError('INTERNAL_ERROR', { message: err instanceof Error ? err.message : String(err) }));
      }
    }
  }

  const docsIndex = path.join(cwd, 'docs', 'current', 'index.md');
  if (fs.existsSync(docsIndex)) {
    addCheck('docs_index_present', true, docsIndex);
  } else {
    addCheck('docs_index_present', false, docsIndex);
    const issue = makeError('DOCS_INDEX_MISSING');
    if (strict) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  const state = errors.length > 0 ? 'blocked' : 'ok';
  const instructions =
    errors.length > 0
      ? 'Doctor found blocking configuration problems.'
      : strict
        ? 'Doctor checks passed in strict mode.'
        : 'Doctor checks passed.';

  writeJson(
    {
      workflow: 'doctor',
      step: 'check',
      state,
      instructions,
      data: {
        cwd,
        strict,
        checks,
        ...(args.change ? { change_name: String(args.change) } : {}),
        ...(changeSearched ? { searched: changeSearched } : {}),
      },
      errors,
      warnings,
    },
    EXIT.ok
  );
}
