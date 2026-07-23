import { loadErrorCatalog } from './policy-loader.mjs';

export function makeError(code, details = {}) {
  let catalog = { errors: {} };

  try {
    catalog = loadErrorCatalog(process.cwd());
  } catch {
    catalog = { errors: {} };
  }

  const def = catalog?.errors?.[code] || {};

  return {
    code,
    message: details.message || def.message || code,
    fix: details.fix || def.fix,
    ...details,
  };
}
