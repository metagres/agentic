import type { CheckImpl, CheckManifest, Finding } from '../types.ts';
import { getTopArray } from '../shared.ts';

export const manifest: CheckManifest = {
  name: 'dependency-order',
  description: 'Requires that no entry depends on an entry that appears later in the array (forward-dependency ordering).',
  params: [
    {
      name: 'array',
      type: 'string',
      required: true,
      description: 'Array selector of the entries whose order is validated (a top-level key name or a path spec).',
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

// dependency-order: a task must not depend on a task that appears later in the
// array (forward-dependency ordering).
export const check: CheckImpl = ({ artifact, params }) => {
  const findings: Finding[] = [];
  const arrayName = String(params.array || '');
  const idField = String(params.id_field || 'id');
  const dependsField = String(params.depends_field || 'depends_on');

  if (!arrayName) return findings;

  const tasks = getTopArray(artifact, arrayName);
  const indexById = new Map<string, number>();
  tasks.forEach((t, i) => {
    const id = String(t?.[idField] || '');
    if (id) indexById.set(id, i);
  });

  tasks.forEach((t) => {
    const taskId = String(t?.[idField] || '');
    const taskIdx = indexById.get(taskId);
    const deps = Array.isArray(t?.[dependsField])
      ? (t[dependsField] as unknown[]).map(String)
      : [];

    for (const dep of deps) {
      const depIdx = indexById.get(dep);
      if (depIdx !== undefined && taskIdx !== undefined && depIdx > taskIdx) {
        findings.push({
          check: 'dependency-order',
          category: 'structural',
          target: arrayName,
          finding: `Task ${taskId} depends on ${dep} which appears later in the plan`,
          fix: 'Reorder tasks so dependencies come first',
        });
      }
    }
  });

  return findings;
};
