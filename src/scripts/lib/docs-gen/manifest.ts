/**
 * docs-gen manifest loader: reads and validates docs-gen.yaml — the single
 * declarative binding of generated files and regions to providers. This is
 * the project-specific wiring seam: other projects port the engine by
 * editing this file, never the engine.
 */

import { readYaml } from '../yaml-io.ts';
import { DocsGenError } from './splice.ts';
import type { DocsGenManifest, ManifestEntry } from './types.ts';

const MANIFEST_PATH = 'docs-gen.yaml';

export function manifestPath(root: string): string {
  return `${root}/${MANIFEST_PATH}`;
}

export function loadManifest(root: string): DocsGenManifest {
  const manifest = readYaml(manifestPath(root)) as DocsGenManifest | null;
  if (!manifest || typeof manifest !== 'object') {
    throw new DocsGenError(`manifest ${MANIFEST_PATH} is missing or not a mapping`);
  }
  if (manifest.version !== 1) {
    throw new DocsGenError(`manifest version must be 1, got ${String(manifest.version)}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new DocsGenError('manifest files must be a non-empty list');
  }

  const seenIds = new Set<string>();
  const filePaths = new Set<string>();
  for (const entry of manifest.files) {
    requireField(entry, 'id', seenIds, 'entry id');
    requireField(entry, 'provider', new Set<string>(), `provider of '${entry.id}'`);
    requireField(entry, 'path', new Set<string>(), `path of '${entry.id}'`);
    if (entry.mode !== 'file' && entry.mode !== 'region') {
      throw new DocsGenError(`entry '${entry.id}' mode must be 'file' or 'region'`);
    }
    if (entry.mode === 'file') {
      if (filePaths.has(entry.path)) {
        throw new DocsGenError(`file path '${entry.path}' is declared by more than one file entry`);
      }
      filePaths.add(entry.path);
    }
   }
  return manifest;
}

function requireField(entry: ManifestEntry, field: keyof ManifestEntry, seen: Set<string>, label: string): void {
  const value = entry[field] as unknown;
  if (typeof value !== 'string' || value.length === 0) {
    throw new DocsGenError(`${label} must be a non-empty string`);
  }
  if (field === 'id') {
    if (seen.has(value)) throw new DocsGenError(`duplicate entry id '${value}'`);
    seen.add(value);
  }
}
