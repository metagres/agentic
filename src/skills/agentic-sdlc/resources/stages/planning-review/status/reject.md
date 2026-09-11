Reject the plan artifact to send it back for corrections.

When mechanical checks fail, bare `--reject` records the CLI-computed mechanical failures — no input needed.
When mechanical checks pass, rejections are evidence-backed: `--reject --failures <file>` with a top-level YAML list of the failed semantic checks as {check, evidence}. The check must quote the checklist question verbatim — an undeclared name is refused and nothing is written. One entry per failed check: merge all findings of that check into the single entry's evidence (two findings joined inside one evidence string below) — a duplicate entry for a check is refused:
- check: "Are each task's acceptance criteria actually verifiable with clear pass/fail conditions?"
  evidence: "T-8 'improve error handling' names no observable pass condition (plan.yaml, tasks[7]). Also T-11 'harden retry logic' names no observable pass condition (plan.yaml, tasks[10])."