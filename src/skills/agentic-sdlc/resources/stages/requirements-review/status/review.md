Run the requirements review against the tracked artifact.

Report only failures, never passed checks: each failure as {check, evidence} with the check named, the evidence quoted rather than paraphrased, and the exact location (artifact, section, clause, or missing link). Mechanical failures are CLI-computed and listed in `data.failures`; walk the semantic checklist yourself and report its failures the same way. With zero failures report one line stating no failures plus the verdict.
A mechanical failure line looks like (mechanical check names are kebab-case identifiers):
`given-when-then`: "FR-4 AC-2 'the system responds' is not a Given-When-Then statement (requirements.yaml, functional_requirements[3].acceptance_criteria[1])"

Name semantic checks exactly as the checklist declares them — a check name the checklist does not carry is refused and nothing is recorded. Semantic checks are named by the full question text copied verbatim: the checklist numbers are list positions, not names. Record at most one entry per failed check, merging all of that check's findings into the single entry's evidence — a duplicate entry for a check is refused.
Issue the verdict through the CLI in this session: bare `--accept` accepts when mechanical checks pass; `--reject --failures <file>` records the failed semantic checks as a top-level YAML list of {check, evidence}. A bare invocation without a verdict flag only opens or refreshes the round — a review without a recorded verdict is incomplete.
Report the finished review in one line: round, verdict, failures count.