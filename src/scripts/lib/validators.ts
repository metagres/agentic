import path from 'node:path';
import { safeReadYaml } from './context.ts';

interface Finding {
  finding: string;
}

function getTopArray(obj: Record<string, unknown>, field: string): any[] {
  return Array.isArray(obj?.[field]) ? obj[field] as any[] : [];
}

// Simple DFS to detect cycles in task dependencies
function hasCycle(tasks: any[]): boolean {
  const graph = new Map<string, string[]>();
  tasks.forEach(t => graph.set(t.id, t.depends_on || []));

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;

    visiting.add(id);
    const deps = graph.get(id) || [];
    for (const dep of deps) {
      if (visit(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const task of tasks) {
    if (visit(task.id)) return true;
  }
  return false;
}

export function checkCrossFileReferences(stageId: string, artifact: any, changeRoot: string): Finding[] {
  const findings: Finding[] = [];

  if (stageId === 'design') {
    const req = safeReadYaml(path.join(changeRoot, 'requirements.yaml')) as any;
    if (req) {
      if (artifact.metadata.based_on_requirements !== req.metadata.version) {
        findings.push({ finding: 'Design metadata.based_on_requirements does not match requirements.yaml version.' });
      }

      const reqIds = new Set([
        ...getTopArray(req, 'functional_requirements').map(r => r.id),
        ...getTopArray(req, 'non_functional_requirements').map(r => r.id)
      ]);

      for (const trace of artifact.traceability || []) {
        if (!reqIds.has(trace.requirement_id)) {
          findings.push({ finding: `Traceability references missing requirement: ${trace.requirement_id}` });
        }
      }
    }
  }

  if (stageId === 'planning') {
    const req = safeReadYaml(path.join(changeRoot, 'requirements.yaml')) as any;
    const design = safeReadYaml(path.join(changeRoot, 'design.yaml')) as any;

    if (req && artifact.metadata.based_on_requirements !== req.metadata.version) {
      findings.push({ finding: 'Plan metadata.based_on_requirements does not match requirements.yaml version.' });
    }
    if (design && artifact.metadata.based_on_design !== design.metadata.version) {
      findings.push({ finding: 'Plan metadata.based_on_design does not match design.yaml version.' });
    }

    if (req) {
      const reqFrIds = new Set(getTopArray(req, 'functional_requirements').map(r => r.id));
      const reqNfrIds = new Set(getTopArray(req, 'non_functional_requirements').map(r => r.id));
      const reqAcIds = new Set(getTopArray(req, 'acceptance_criteria').map(r => r.id));

      for (const task of artifact.tasks || []) {
        for (const coverId of task.covers || []) {
          if (!reqFrIds.has(coverId) && !reqNfrIds.has(coverId)) {
            findings.push({ finding: `Task ${task.id} covers missing requirement: ${coverId}` });
          }
        }
        for (const acId of task.acceptance_ids || []) {
          if (!reqAcIds.has(acId)) {
            findings.push({ finding: `Task ${task.id} references missing AC: ${acId}` });
          }
        }
      }
    }

    if (design) {
      const decIds = new Set(getTopArray(design, 'decisions').map(d => d.id));
      for (const task of artifact.tasks || []) {
        for (const decId of task.design_refs || []) {
          if (!decIds.has(decId)) {
            findings.push({ finding: `Task ${task.id} references missing design decision: ${decId}` });
          }
        }
      }
    }

    if (hasCycle(artifact.tasks || [])) {
      findings.push({ finding: 'Task dependency graph contains a cycle.' });
    }
  }

  return findings;
}