One task per turn:

1. Pick the next task via `data.progress.next_task_ids`. Read the living docs that apply to this task's files plus the target files — chained silently, before the first edit.
2. Implement exactly what the task specifies. Consult the plan's risks and their mitigations for affected tasks.
3. Verify against the task's acceptance criteria: run the checks they call for (tests, lint, build as applicable). Fix root causes — never suppress a failing check to pass it. If the same failure survives two fix attempts, mark the task blocked with the evidence in the note instead of iterating further.
4. Record through the script. The note states what changed and how it was verified (test, lint, or manual check; the command when applicable). Report one line: task id + outcome (done/blocked).

## Planning quality guardrails

Before and during implementation:

- A task should be one coherent unit of work, not a whole feature and not pseudocode.
- Do not mix refactoring and new behavior in the same task if avoidable.
- For refactoring, ensure behavior-preserving tests exist before changing code.
- If implementation requires unplanned architectural or behavioral changes, stop and update the plan.
- Incidental changes such as imports, formatting, or test helpers are acceptable with a clear note.
- Every done, blocked, or skipped task must have an implementation note: one sentence stating what changed and how it was verified (test, lint, or manual check; the command when applicable).