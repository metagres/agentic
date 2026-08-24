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

// The error catalog is the only central policy left; everything else moved
// into per-stage folders (DEC-011).
export function loadErrorCatalog(cwd: string = process.cwd()): unknown {
  return loadPolicy('policies', 'errors.yaml', cwd);
}
