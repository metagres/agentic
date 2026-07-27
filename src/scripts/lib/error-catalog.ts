import { loadErrorCatalog } from './policy-loader.ts';

export function makeError(code: string, details: Record<string, unknown> = {}): { code: string; message: string; fix?: string } {
  let catalog: { errors: Record<string, { message?: string; fix?: string }> } = { errors: {} };

  try {
    catalog = loadErrorCatalog(process.cwd()) as { errors: Record<string, { message?: string; fix?: string }> };
  } catch {
    catalog = { errors: {} };
  }

  const def: { message?: string; fix?: string } = (catalog?.errors?.[code] || {});

  return {
    code,
    message: String(details.message || def.message || code),
    fix: String(details.fix || def.fix || ''),
    ...details,
  } as { code: string; message: string; fix?: string };
}
