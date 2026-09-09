/**
 * docs-gen shared types: the provider contract, the manifest schema, and
 * the normalized fact vocabulary. The fact vocabulary is the portability
 * seam — language packs in other projects emit these same shapes, so the
 * shared renderers stay written once. Nothing here knows repo paths.
 */

export interface ProviderContext {
  /** Repository root (every provider path resolves against it). */
  root: string;
  /** Rendered content of files already generated in this run (by file id). */
  rendered: Map<string, string>;
  /** Rendered content of a previously generated file, or null. */
  readRendered(fileId: string): string | null;
  /** Current on-disk content of a repo-relative path; '' when absent. */
  readExisting(relPath: string): string;
}

export interface FileProvider {
  mode: 'file';
  render(ctx: ProviderContext): string[];
}

export interface RegionProvider {
  mode: 'region';
  render(ctx: ProviderContext, params: Record<string, unknown>): string[];
}

export type Provider = FileProvider | RegionProvider;

export interface ManifestEntry {
  id: string;
  provider: string;
  path: string;
  mode: 'file' | 'region';
  /** File ids whose rendered content this entry consumes (generation order). */
  reads?: string[];
  params?: Record<string, unknown>;
}

export interface DocsGenManifest {
  version: number;
  files: ManifestEntry[];
}

export interface DependencyFact {
  name: string;
  version: string;
  scope: 'runtime' | 'dev';
  evidence: string;
}

export interface CommandFact {
  id: string;
  invocation: string;
  evidence: string;
}

export interface EnvVarFact {
  name: string;
  purpose: string;
  required: string;
  evidence: string;
}

export interface EdgeFact {
  from: string;
  to: string;
  kind: string;
}

export interface EntityFieldFact {
  field: string;
  type: string;
  nullable: string;
  source: string;
}

export interface ErrorCatalogFact {
  code: string;
  message: string;
  fix: string;
  emittedAt: string;
}

export interface MarkerFinding {
  location: string;
  marker: string;
  context: string;
  severity: string;
  evidence: string;
}
