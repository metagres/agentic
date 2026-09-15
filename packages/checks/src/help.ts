import type { CheckManifest, ParamSpec } from './types.ts';

/**
 * Renders one check manifest as human-readable --help text: the check name
 * and description, followed by one aligned row per parameter with its type,
 * whether it is required, its default when defined, and its description.
 */
export function formatHelp(manifest: CheckManifest): string {
  const rows = manifest.params.map((p: ParamSpec) => ({
    name: p.name,
    type: p.type,
    required: p.required ? 'required' : 'optional',
    default: p.default === undefined ? '' : `default: ${JSON.stringify(p.default)}`,
    description: p.description,
  }));

  const width = (values: string[]): number => Math.max(0, ...values.map((v) => v.length));
  const nameW = width(rows.map((r) => r.name));
  const typeW = width(rows.map((r) => r.type));
  const reqW = width(rows.map((r) => r.required));
  const defW = width(rows.map((r) => r.default));

  const lines: string[] = [`${manifest.name} — ${manifest.description}`, ''];

  if (rows.length === 0) {
    lines.push('This check takes no parameters.');
    return lines.join('\n');
  }

  lines.push('Parameters:');
  for (const row of rows) {
    const cells = [
      row.name.padEnd(nameW),
      row.type.padEnd(typeW),
      row.required.padEnd(reqW),
    ];
    if (defW > 0) cells.push(row.default.padEnd(defW));
    lines.push(`  ${cells.join('  ')}  ${row.description}`);
  }

  return lines.join('\n');
}
