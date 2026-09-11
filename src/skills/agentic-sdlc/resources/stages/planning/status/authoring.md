Draft the plan artifact. Chain script calls silently.

Reuse investigation — before decomposing, consult the living docs' inventory of existing components, then search the repo for existing utilities that partially resolve each FR/DEC area, and classify:
- Reuse as-is: consumer tasks cite the existing file path.
- Reuse with adaptation: a `type: refactor` task (files: `modify` on the real paths), preceded by a task adding behavior-preserving tests (`depends_on`); consumer tasks depend on the refactor task.
- No fit: new code, with the rejected existing alternative named in the task description.
- Uncertain fit: a `type: analysis` task decides it; consumers depend on it.
Reuse that would change a shared contract's behavior is a design decision — route it back to design as a DEC; never decide it here.

Sequencing:
- Dependency-first and breadth-safe: stable foundations and shared contracts land before their consumers.
- A task too large to verify in one pass is split.
- `depends_on` carries only real dependencies.
- Descriptions state what and where — never symbol naming or how.

Task contracts:
- Use `data.next_ids` to choose TASK ids; reference requirements and decisions by id (`covers`, `acceptance_ids`, `design_refs`).
- `files` is the task's blast-radius contract: every file the task creates, modifies, or deletes, with its operation. Incidental gaps are noted at implementation; behavioral gaps block and amend the plan.
- Retirement: a task that supersedes behavior, files, or docs plans the removal (delete/modify files entry or delta entry) — the plan leaves no dead code or stale documentation.
- An open question is not an interview: it becomes a risks entry (description + mitigation). A mitigation names a task, a dependency, or an explicitly accepted contingency.

While drafting, determine which living docs are affected by the plan and append delta entries via --append-delta (allowed targets: `data.delta_allowed_target_docs`) or include them in --update-artifact. Knowledge extraction dedupes.

Example task (reuse with adaptation; TASK-003 holds the behavior-preserving tests):
- id: TASK-004
  title: Adapt ReportFormatter to emit CSV
  description: >
    Extend the existing src/lib/report-formatter.ts with a CSV emitter
    (reuses DEC-002's ReportFormatter; rejected a standalone exporter).
  type: refactor
  status: pending
  covers: [FR-003]
  acceptance_ids: [AC-005]
  design_refs: [DEC-002]
  depends_on: [TASK-003]
  files:
    - path: src/lib/report-formatter.ts
      operation: modify
    - path: test/report-formatter.test.ts
      operation: create

Mechanical checks (CLI-enforced; every finding blocks finalize and review —
the full table lives in docs/current/conventions.md):
- unique-ids: task/milestone/risk ids unique
- ref-exists and ref-covers: tasks cover FRs and acceptance criteria,
  milestones reference existing tasks, design_refs resolve
- dependency-acyclic and dependency-order: no dependency cycles, and a
  dependency appears before the tasks that depend on it

Write the artifact through the script. Report one line: plan authored (N tasks, M milestones, K risks, J delta entries).