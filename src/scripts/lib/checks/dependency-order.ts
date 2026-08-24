import type { Finding } from '../types.ts';
import type { CheckFn } from './shared.ts';
import { getTopArray } from './shared.ts';

// dependency-order: a task must not depend on a task that appears later in the
// array (forward-dependency ordering).
export const dependencyOrder: CheckFn = (artifact, params) => {
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
          severity: 'blocking',
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
