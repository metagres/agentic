import { readYaml } from './yaml-io.ts';
import { resolveRuntimeFile } from './paths.ts';

const cache = new Map();

function loadPolicy(dirName: string, fileName: string, cwd: string): unknown {
  const abs = resolveRuntimeFile('policies', fileName, cwd);
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

export function loadSemanticChecks(cwd: string = process.cwd()): Record<string, string[]> {
  try {
    const doc = loadPolicy('policies', 'semantic-checks.yaml', cwd) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [stage, checks] of Object.entries(doc)) {
      if (Array.isArray(checks)) {
        out[stage] = checks.filter(c => typeof c === 'string');
      }
    }
    return out;
  } catch {
    return {}; 
  }
}