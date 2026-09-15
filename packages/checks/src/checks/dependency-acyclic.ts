import type { CheckImpl, CheckManifest, Finding } from '../types.ts';
import { getTopArray } from '../shared.ts';

export const manifest: CheckManifest = {
  name: 'dependency-acyclic',
  description: 'Requires the dependency graph over the configured array to contain no cycles.',
  params: [
    {
      name: 'array',
      type: 'string',
      required: true,
      description: 'Array selector of the entries that form the dependency graph (a top-level key name or a path spec).',
    },
    {
      name: 'id_field',
      type: 'string',
      required: false,
      default: 'id',
      description: 'Per-entry property that holds the identifier other entries depend on.',
    },
    {
      name: 'depends_field',
      type: 'string',
      required: false,
      default: 'depends_on',
      description: 'Per-entry property that holds the list of ids this entry depends on.',
    },
  ],
};

// dependency-acyclic: the dependency graph over {array} via {depends_field}
// must contain no cycles.
export const check: CheckImpl = ({ artifact, params }) => {
  const findings: Finding[] = [];
  const arrayName = String(params.array || '');
  const idField = String(params.id_field || 'id');
  const dependsField = String(params.depends_field || 'depends_on');

  if (!arrayName) return findings;

  const items = getTopArray(artifact, arrayName);
  const graph = new Map<string, string[]>();
  items.forEach((t) => {
    const id = String(t?.[idField] || '');
    const deps = Array.isArray(t?.[dependsField])
      ? (t[dependsField] as unknown[]).map(String)
      : [];
    graph.set(id, deps);
  });

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  function visit(id: string): boolean {
    if (color.get(id) === GRAY) return true;
    if (color.get(id) === BLACK) return false;

    color.set(id, GRAY);
    for (const dep of graph.get(id) || []) {
      if (visit(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  for (const t of items) {
    const id = String(t?.[idField] || '');
    if (visit(id)) {
      findings.push({
        check: 'dependency-acyclic',
        category: 'structural',
        target: arrayName,
        finding: 'Task dependency graph contains a cycle.',
        fix: 'Remove the dependency cycle',
      });
      break;
    }
  }

  return findings;
};
