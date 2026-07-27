import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYaml } from './yaml-io.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();

function resolvePolicyFile(dirName: string, fileName: string, cwd: string): string | null {
  const candidates = [
    // Bundled/deployed runtime:
    //   <agent-root>/sdlc/scripts/sdlc.js
    //   <agent-root>/sdlc/<dirName>/<fileName>
    path.resolve(scriptDir, '..', dirName, fileName),

    // Development runtime:
    //   src/scripts/lib/policy-loader.ts
    //   src/<dirName>/<fileName>
    path.resolve(scriptDir, '..', '..', dirName, fileName),

    // Extra fallbacks.
    path.resolve(scriptDir, '..', '..', '..', dirName, fileName),
    path.join(cwd, dirName, fileName),
    path.join(cwd, 'src', dirName, fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadPolicy(dirName: string, fileName: string, cwd: string): unknown {
  const abs = resolvePolicyFile(dirName, fileName, cwd);
  if (!abs) {
    throw new Error(`Policy file not found: ${dirName}/${fileName}`);
  }

  if (!cache.has(abs)) {
    cache.set(abs, readYaml(abs));
  }

  return cache.get(abs);
}

export function loadPipeline(cwd: string = process.cwd()): unknown {
  return loadPolicy('policies', 'pipeline.yaml', cwd);
}

export function loadReviewTargets(cwd: string = process.cwd()): unknown {
  return loadPolicy('policies', 'review-targets.yaml', cwd);
}

export function loadLifecycle(cwd: string = process.cwd()): unknown {
  return loadPolicy('policies', 'lifecycle.yaml', cwd);
}

export function loadRequirementsPolicy(cwd: string = process.cwd()): unknown {
  return loadPolicy('policies', 'requirements-policy.yaml', cwd);
}

export function loadSemanticPolicy(cwd: string = process.cwd()): unknown {
  return loadPolicy('policies', 'semantic-policy.yaml', cwd);
}

export function loadErrorCatalog(cwd: string = process.cwd()): unknown {
  return loadPolicy('policies', 'errors.yaml', cwd);
}

export function loadIdsCatalog(cwd: string = process.cwd()): unknown {
  return loadPolicy('policies', 'ids.yaml', cwd);
}
