# review

Run the implementation review against the tracked plan artifact.

Report only failures, never passed checks: each failure as {check, evidence} with the check named, the evidence quoted rather than paraphrased, and the exact location (artifact, section, clause, or missing link). Mechanical failures are CLI-computed and listed in `data.failures`; walk the semantic checklist yourself and report its failures the same way. With zero failures report one line stating no failures plus the verdict.
A mechanical failure line looks like (mechanical check names are kebab-case identifiers):
`required-note-for-status`: "T-5 is done without an implementation note (plan.yaml, tasks[4])"

Name semantic checks exactly as the checklist declares them — a check name the checklist does not carry is refused and nothing is recorded. Semantic checks are named by the full question text copied verbatim: the checklist numbers are list positions, not names. Record at most one entry per failed check, merging all of that check's findings into the single entry's evidence — a duplicate entry for a check is refused.
Issue the verdict through the CLI in this session: bare `--accept` accepts when mechanical checks pass; `--reject --failures <file>` records the failed semantic checks as a top-level YAML list of {check, evidence}. A bare invocation without a verdict flag only opens or refreshes the round — a review without a recorded verdict is incomplete.
Report the finished review in one line: round, verdict, failures count.

# accept

Accept the implementation when mechanical checks pass and the semantic checklist raised no failures.

Run bare `--accept` — no findings file: the round is recorded accepted with `failures: []` and both valid flags true.
If mechanical checks fail, acceptance is impossible: the round is forced rejected and the artifact is flipped to rejected — fix the recorded failures first.

# reject

Reject the implementation to send it back for corrections.

When mechanical checks fail, bare `--reject` records the CLI-computed mechanical failures — no input needed.
When mechanical checks pass, rejections are evidence-backed: `--reject --failures <file>` with a top-level YAML list of the failed semantic checks as {check, evidence}. The check must quote the checklist question verbatim — an undeclared name is refused and nothing is written. One entry per failed check: merge all findings of that check into the single entry's evidence (two findings joined inside one evidence string below) — a duplicate entry for a check is refused:
- check: "Is there evidence that the work was verified (tests, manual verification notes, CLI output)?"
  evidence: "T-9 notes 'parser change done' with no test or verification command (plan.yaml, tasks[8]). Also T-10 is done but its implementation note names no requirement id (plan.yaml, tasks[9])."