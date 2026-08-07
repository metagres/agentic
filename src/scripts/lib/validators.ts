import path from 'node:path';
import { safeReadYaml } from './context.ts';

interface Finding {
  finding: string;
  severity?: string;
  category?: string;
  fix?: string;
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

  if (stageId === 'requirements') {
    const frs = getTopArray(artifact, 'functional_requirements');
    const nfrs = getTopArray(artifact, 'non_functional_requirements');
    const acs = getTopArray(artifact, 'acceptance_criteria');
    const discovery = getTopArray(artifact, 'discovery_log');

    // Orphan AC: an AC id not referenced by any FR or NFR.
    const referencedAcIds = new Set<string>();
    for (const fr of frs) {
      for (const acId of fr.ac_ids || []) referencedAcIds.add(acId);
    }
    for (const nfr of nfrs) {
      for (const acId of nfr.ac_ids || []) referencedAcIds.add(acId);
    }
    for (const ac of acs) {
      if (!referencedAcIds.has(ac.id)) {
        findings.push({
          finding: `${ac.id} is not referenced by any FR or NFR`,
          severity: 'minor',
          category: 'traceability',
        });
      }
    }

    // Duplicate ids within each array.
    const arrays: { name: string; items: any[] }[] = [
      { name: 'functional_requirements', items: frs },
      { name: 'non_functional_requirements', items: nfrs },
      { name: 'acceptance_criteria', items: acs },
      { name: 'discovery_log', items: discovery },
    ];
    for (const { name, items } of arrays) {
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.id)) {
          findings.push({
            finding: `Duplicate ID '${item.id}' in '${name}'`,
            severity: 'blocking',
            category: 'structural',
          });
        }
        seen.add(item.id);
      }
    }

    // Duplicate AC references within each FR and NFR.
    for (const fr of frs) {
      const seen = new Set<string>();
      for (const acId of fr.ac_ids || []) {
        if (seen.has(acId)) {
          findings.push({
            finding: `Duplicate AC reference '${acId}' in ${fr.id}`,
            severity: 'minor',
            category: 'traceability',
          });
        }
        seen.add(acId);
      }
    }
    for (const nfr of nfrs) {
      const seen = new Set<string>();
      for (const acId of nfr.ac_ids || []) {
        if (seen.has(acId)) {
          findings.push({
            finding: `Duplicate AC reference '${acId}' in ${nfr.id}`,
            severity: 'minor',
            category: 'traceability',
          });
        }
        seen.add(acId);
      }
    }
  }

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

      // Duplicate component refs within each traceability entry.
      for (const trace of artifact.traceability || []) {
        const seen = new Set<string>();
        for (const compId of trace.component_ids || []) {
          if (seen.has(compId)) {
            findings.push({
              finding: `Duplicate component_id '${compId}' in traceability entry for requirement_id '${trace.requirement_id}'`,
              severity: 'minor',
              category: 'traceability',
            });
          }
          seen.add(compId);
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

    // Dependency order: a task must not depend on a task that appears later.
    const tasks = artifact.tasks || [];
    const indexById = new Map<string, number>();
    tasks.forEach((t: any, i: number) => indexById.set(t.id, i));
    tasks.forEach((t: any) => {
      const taskIdx = indexById.get(t.id);
      for (const dep of t.depends_on || []) {
        const depIdx = indexById.get(dep);
        if (depIdx !== undefined && taskIdx !== undefined && depIdx > taskIdx) {
          findings.push({
            finding: `Task ${t.id} depends on ${dep} which appears later in the plan`,
            severity: 'blocking',
            category: 'structural',
          });
        }
      }
    });
  }

  if (stageId === 'implementation') {
    const tasks = artifact.tasks || [];

    // Execution note required for done/blocked/skipped tasks.
    for (const task of tasks) {
      if (['done', 'blocked', 'skipped'].includes(task.status)) {
        const note = task.implementation_note;
        if (!note || String(note).trim().length === 0) {
          findings.push({
            finding: `Task ${task.id} has status '${task.status}' but no implementation_note`,
            severity: 'blocking',
            category: 'completeness',
          });
        }
      }
    }

    // All tasks must be done or skipped.
    const doneOrSkipped = tasks.filter((t: any) =>
      ['done', 'skipped'].includes(t.status)
    ).length;
    if (tasks.length > 0 && doneOrSkipped < tasks.length) {
      findings.push({
        finding: `Not all tasks are complete (${doneOrSkipped} of ${tasks.length} done/skipped)`,
        severity: 'blocking',
        category: 'completeness',
      });
    }
  }

  return findings;
}