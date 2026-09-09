/**
 * docs-gen orchestrator: runs manifest entries in order against the
 * provider registry, producing rendered file contents. Providers run in
 * manifest order; later entries see earlier entries' rendered content
 * through readRendered and read the in-flight content of files already
 * touched this run through readExisting. After the manifest loop the
 * crosscheck gate runs as a hard failing check — violations abort the run
 * before anything is written or reported as fresh. The orchestrator is
 * pure — the bin decides between writing and checking.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runCrosschecks } from './crosscheck.ts';
import { DocsGenError, replaceRegion } from './splice.ts';
import type { DocsGenManifest, FileProvider, Provider, RegionProvider, ProviderContext } from './types.ts';

export type ProviderRegistry = Map<string, Provider>;

export interface RenderedFile {
  path: string;
  content: string;
  touchedBy: string[];
}

export function generateAll(
  root: string,
  manifest: DocsGenManifest,
  registry: ProviderRegistry
): Map<string, RenderedFile> {
  const rendered = new Map<string, string>();
  const inFlight = new Map<string, string>();
  const results = new Map<string, RenderedFile>();

  const ctx: ProviderContext = {
    root,
    rendered,
    readRendered: (fileId: string) => rendered.get(fileId) ?? null,
    readExisting: (relPath: string) => {
      const inFlightContent = inFlight.get(relPath);
      if (inFlightContent !== undefined) return inFlightContent;
      const abs = path.join(root, relPath);
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    },
  };

  for (const entry of manifest.files) {
    const provider = registry.get(entry.provider);
    if (!provider) {
      throw new DocsGenError(`entry '${entry.id}' references unknown provider '${entry.provider}'`);
    }
    if (provider.mode !== entry.mode) {
      throw new DocsGenError(
        `entry '${entry.id}' declares mode '${entry.mode}' but provider '${entry.provider}' is a '${provider.mode}' provider`
      );
    }

    let content: string;
    if (entry.mode === 'file') {
      content = (provider as FileProvider).render(ctx).join('\n');
      inFlight.set(entry.path, content);
      rendered.set(entry.id, content);
    } else {
      const current = ctx.readExisting(entry.path);
      const regionLines = (provider as RegionProvider).render(ctx, {
        ...(entry.params ?? {}),
        regionId: entry.id,
      });
      try {
        content = replaceRegion(current, entry.id, regionLines);
      } catch (err) {
        if (err instanceof DocsGenError && err.message.includes('does not declare')) {
          throw new DocsGenError(
            `${entry.path} does not declare region '${entry.id}' — insert the docs-gen markers first (one-time migration)`
          );
        }
        throw err;
      }
      inFlight.set(entry.path, content);
    }

    const previous = results.get(entry.path);
    results.set(entry.path, {
      path: entry.path,
      content,
      touchedBy: [...(previous?.touchedBy ?? []), entry.id],
    });
  }

  runCrosschecks(ctx);

  return results;
}
