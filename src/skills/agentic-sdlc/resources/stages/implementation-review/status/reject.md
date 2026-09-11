Reject the implementation to send it back for corrections.

When mechanical checks fail, bare `--reject` records the CLI-computed mechanical failures — no input needed.
When mechanical checks pass, rejections are evidence-backed: `--reject --failures <file>` with a top-level YAML list of the failed semantic checks as {check, evidence}. The check must quote the checklist question verbatim — an undeclared name is refused and nothing is written. One entry per failed check: merge all findings of that check into the single entry's evidence (two findings joined inside one evidence string below) — a duplicate entry for a check is refused:
- check: "Is there evidence that the work was verified (tests, manual verification notes, CLI output)?"
  evidence: "T-9 notes 'parser change done' with no test or verification command (plan.yaml, tasks[8]). Also T-10 is done but its implementation note names no requirement id (plan.yaml, tasks[9])."